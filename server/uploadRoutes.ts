import { Router, Request, Response } from 'express';
import express from 'express';
import { randomUUID } from 'crypto';
import { db } from './db.js';
import { uploads } from '../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { ObjectStorageService, objectStorageClient } from './replit_integrations/object_storage/objectStorage.js';
import { GoogleGenAI } from "@google/genai";

const router = Router();
const jsonParser = express.json({ limit: '50mb' });
const objectStorageService = new ObjectStorageService();

const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/mpeg', 'video/3gpp', 'video/3gpp2'
];
const MAX_VIDEO_SIZE_BYTES = 2000 * 1024 * 1024; // 2GB
const PRESIGN_TTL_SEC = 900; // 15 minutes

interface InitRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  attemptId: string;
  sessionId?: number;
}

interface CompleteRequest {
  uploadId: string;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
  contentType,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
  contentType?: string;
}): Promise<string> {
  const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
  const request: any = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  if (contentType) {
    request.content_type = contentType;
  }
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to sign object URL, errorcode: ${response.status}`);
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

router.post('/init', jsonParser, async (req: Request, res: Response) => {
  try {
    const { filename, mimeType, sizeBytes, attemptId, sessionId } = req.body as InitRequest;

    if (!filename || !mimeType || !sizeBytes || !attemptId) {
      return res.status(400).json({ error: 'Missing required fields: filename, mimeType, sizeBytes, attemptId' });
    }

    if (!mimeType.startsWith('video/') && !ALLOWED_VIDEO_MIMETYPES.includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid file type. Only video files are allowed.' });
    }

    if (sizeBytes > MAX_VIDEO_SIZE_BYTES) {
      return res.status(400).json({ error: `File too large. Maximum size is ${MAX_VIDEO_SIZE_BYTES / (1024 * 1024)}MB` });
    }

    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.attemptId, attemptId))
      .limit(1);

    if (existingUpload.length > 0) {
      const existing = existingUpload[0];
      const privateDir = objectStorageService.getPrivateObjectDir();
      const fullPath = `${privateDir}/${existing.storageKey}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const putUrl = await signObjectURL({
        bucketName,
        objectName,
        method: 'PUT',
        ttlSec: PRESIGN_TTL_SEC,
        contentType: existing.mimeType,
      });

      return res.json({
        uploadId: existing.uploadId,
        storageKey: existing.storageKey,
        putUrl,
        headers: { 'Content-Type': existing.mimeType },
        expiresInSec: PRESIGN_TTL_SEC,
      });
    }

    const uploadId = `upl_${randomUUID().replace(/-/g, '')}`;
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = sessionId
      ? `sessions/${sessionId}/${uploadId}/${safeFilename}`
      : `uploads/${uploadId}/${safeFilename}`;

    const privateDir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${privateDir}/${storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const putUrl = await signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: PRESIGN_TTL_SEC,
      contentType: mimeType,
    });

    await db.insert(uploads).values({
      uploadId,
      sessionId: sessionId ?? null,
      attemptId,
      filename,
      mimeType,
      sizeBytes,
      storageKey,
      status: 'UPLOADING',
      progress: { stage: 'uploading', pct: 0 },
    });

    console.log(`[Upload] Initialized upload ${uploadId} for ${filename} (${sizeBytes} bytes)`);

    res.json({
      uploadId,
      storageKey,
      putUrl,
      headers: { 'Content-Type': mimeType },
      expiresInSec: PRESIGN_TTL_SEC,
    });
  } catch (error: any) {
    console.error('[Upload] Init error:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

router.post('/complete', jsonParser, async (req: Request, res: Response) => {
  try {
    const { uploadId } = req.body as CompleteRequest;

    if (!uploadId) {
      return res.status(400).json({ error: 'Missing required field: uploadId' });
    }

    const uploadRecord = await db
      .select()
      .from(uploads)
      .where(eq(uploads.uploadId, uploadId))
      .limit(1);

    if (uploadRecord.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadRecord[0];

    if (upload.status !== 'UPLOADING') {
      return res.json({ status: upload.status });
    }

    const privateDir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${privateDir}/${upload.storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(400).json({ error: 'File not found in storage. Upload may have failed.' });
    }

    const [metadata] = await file.getMetadata();
    const actualSize = parseInt(metadata.size as string, 10);
    
    const sizeTolerance = 1024;
    if (Math.abs(actualSize - upload.sizeBytes) > sizeTolerance) {
      console.error(`[Upload] Size mismatch for ${uploadId}: expected ${upload.sizeBytes}, got ${actualSize}`);
      return res.status(400).json({ 
        error: `File size mismatch. Expected ${upload.sizeBytes} bytes, received ${actualSize} bytes. Please try uploading again.` 
      });
    }

    await db
      .update(uploads)
      .set({
        status: 'STORED',
        progress: { stage: 'stored', pct: 100 },
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId));

    console.log(`[Upload] Completed upload ${uploadId}, starting Gemini transfer...`);

    transferToGemini(uploadId).catch(err => {
      console.error(`[Upload] Background transfer failed for ${uploadId}:`, err);
    });

    res.json({ status: 'STORED' });
  } catch (error: any) {
    console.error('[Upload] Complete error:', error);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

router.get('/status/:uploadId', async (req: Request, res: Response) => {
  try {
    const { uploadId } = req.params;

    const uploadRecord = await db
      .select()
      .from(uploads)
      .where(eq(uploads.uploadId, uploadId))
      .limit(1);

    if (uploadRecord.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadRecord[0];

    res.json({
      status: upload.status,
      progress: upload.progress,
      geminiFileUri: upload.geminiFileUri,
      lastError: upload.lastError,
      mimeType: upload.mimeType,
      filename: upload.filename,
    });
  } catch (error: any) {
    console.error('[Upload] Status error:', error);
    res.status(500).json({ error: 'Failed to get upload status' });
  }
});

async function transferToGemini(uploadId: string): Promise<void> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    await updateUploadError(uploadId, 'GEMINI_API_KEY not configured');
    return;
  }

  const uploadRecord = await db
    .select()
    .from(uploads)
    .where(eq(uploads.uploadId, uploadId))
    .limit(1);

  if (uploadRecord.length === 0) return;
  const upload = uploadRecord[0];

  try {
    await db
      .update(uploads)
      .set({
        status: 'TRANSFERRING_TO_GEMINI',
        progress: { stage: 'transferring', pct: 0 },
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId));

    const privateDir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${privateDir}/${upload.storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    console.log(`[Upload] Starting resumable upload to Gemini for ${uploadId}`);

    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB chunks
    const startUploadResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(upload.sizeBytes),
          'X-Goog-Upload-Header-Content-Type': upload.mimeType,
        },
        body: JSON.stringify({
          file: { display_name: upload.filename },
        }),
      }
    );

    if (!startUploadResponse.ok) {
      const errText = await startUploadResponse.text();
      throw new Error(`Failed to start Gemini upload: ${errText}`);
    }

    const uploadUri = startUploadResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUri) {
      throw new Error('No upload URI returned from Gemini');
    }

    const readStream = file.createReadStream();
    let offset = 0;
    const chunks: Buffer[] = [];
    let currentChunk = Buffer.alloc(0);

    for await (const data of readStream) {
      currentChunk = Buffer.concat([currentChunk, data as Buffer]);

      while (currentChunk.length >= CHUNK_SIZE) {
        const chunk = currentChunk.slice(0, CHUNK_SIZE);
        currentChunk = currentChunk.slice(CHUNK_SIZE);
        
        const isLast = offset + chunk.length >= upload.sizeBytes;
        const command = isLast ? 'upload, finalize' : 'upload';

        const uploadResponse = await fetch(uploadUri, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunk.length),
            'X-Goog-Upload-Offset': String(offset),
            'X-Goog-Upload-Command': command,
          },
          body: chunk,
        });

        if (!uploadResponse.ok) {
          const errText = await uploadResponse.text();
          throw new Error(`Chunk upload failed at offset ${offset}: ${errText}`);
        }

        offset += chunk.length;
        const pct = Math.min(99, Math.floor((offset / upload.sizeBytes) * 100));
        console.log(`[Upload] Gemini transfer ${uploadId}: ${pct}% (${Math.round(offset / 1024 / 1024)}MB / ${Math.round(upload.sizeBytes / 1024 / 1024)}MB)`);
        
        await db
          .update(uploads)
          .set({
            progress: { stage: 'transferring', pct },
            updatedAt: new Date(),
          })
          .where(eq(uploads.uploadId, uploadId));
      }
    }

    if (currentChunk.length > 0) {
      const uploadResponse = await fetch(uploadUri, {
        method: 'PUT',
        headers: {
          'Content-Length': String(currentChunk.length),
          'X-Goog-Upload-Offset': String(offset),
          'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: currentChunk,
      });

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        throw new Error(`Final chunk upload failed: ${errText}`);
      }

      console.log(`[Upload] Gemini transfer ${uploadId}: 100% - upload complete, waiting for processing...`);

      const result = await uploadResponse.json();
      const geminiFile = result.file;
      
      if (geminiFile?.uri) {
        await pollForActive(uploadId, geminiFile.name, GEMINI_API_KEY);
      } else {
        throw new Error('No file URI in Gemini response');
      }
    }

  } catch (error: any) {
    console.error(`[Upload] Gemini transfer error for ${uploadId}:`, error);
    await updateUploadError(uploadId, error.message || 'Transfer to Gemini failed');
  }
}

async function pollForActive(uploadId: string, geminiFileName: string, apiKey: string): Promise<void> {
  const maxAttempts = 60; // 5 minutes max (5s intervals)
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${apiKey}`
    );
    
    if (!response.ok) {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    const fileInfo = await response.json();
    
    if (fileInfo.state === 'ACTIVE') {
      await db
        .update(uploads)
        .set({
          status: 'ACTIVE',
          geminiFileUri: fileInfo.uri,
          progress: { stage: 'ready', pct: 100 },
          updatedAt: new Date(),
        })
        .where(eq(uploads.uploadId, uploadId));
      
      console.log(`[Upload] ${uploadId} is now ACTIVE with URI: ${fileInfo.uri}`);
      return;
    }

    if (fileInfo.state === 'FAILED') {
      throw new Error('Gemini file processing failed');
    }

    await db
      .update(uploads)
      .set({
        progress: { stage: 'processing', pct: 99 },
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId));

    await new Promise(r => setTimeout(r, 5000));
  }

  throw new Error('Timeout waiting for Gemini file to become active');
}

async function updateUploadError(uploadId: string, error: string): Promise<void> {
  await db
    .update(uploads)
    .set({
      status: 'FAILED',
      lastError: error,
      progress: { stage: 'failed', pct: 0 },
      updatedAt: new Date(),
    })
    .where(eq(uploads.uploadId, uploadId));
}

export default router;
