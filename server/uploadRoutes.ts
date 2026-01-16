import { Router, Request, Response } from 'express';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from './db.js';
import { uploads } from '../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { ObjectStorageService, objectStorageClient } from './replit_integrations/object_storage/objectStorage.js';
import { GoogleGenAI } from "@google/genai";
import { cleanupTempFile } from './services/videoCompressor.js';
import { ProgressFlushManager, writeMilestone } from './services/progressManager.js';

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
        progress: { stage: 'stored', pct: 5, message: 'Upload complete' },
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId));

    console.log(`[Upload] Completed upload ${uploadId}, starting Gemini transfer...`);

    transferToGemini(uploadId).catch(err => {
      console.error(`[Upload] Background processing failed for ${uploadId}:`, err);
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

  let tempInputPath: string | null = null;

  try {
    // Stage 1: Download from Object Storage to temp file
    await db
      .update(uploads)
      .set({
        status: 'PREPARING',
        progress: { stage: 'preparing', pct: 5, message: 'Preparing file for AI...' },
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId));

    const privateDir = objectStorageService.getPrivateObjectDir();
    const fullPath = `${privateDir}/${upload.storageKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const tempDir = path.join(os.tmpdir(), 'focalpoint-downloads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    tempInputPath = path.join(tempDir, `${uploadId}_${upload.filename}`);

    console.log(`[Upload] Downloading ${uploadId} to ${tempInputPath} for Gemini transfer...`);

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempInputPath!);
      file.createReadStream()
        .on('error', reject)
        .pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });

    console.log(`[Upload] Download complete for ${uploadId}, preparing for Gemini transfer...`);

    // Get file size directly (compression is disabled)
    const fileStats = fs.statSync(tempInputPath);
    const fileForGemini = tempInputPath;
    const fileSize = fileStats.size;
    
    console.log(`[Upload] Direct upload for ${uploadId}: ${(fileSize / 1024 / 1024).toFixed(1)}MB (compression disabled)`);

    // Stage 2: Transfer file directly to Gemini
    await writeMilestone(uploadId, 'GEMINI_UPLOAD_STARTED', {
      status: 'TRANSFERRING_TO_GEMINI',
    });

    console.log(`[Upload] Starting Gemini upload for ${uploadId} (${(fileSize / 1024 / 1024).toFixed(1)}MB original file)`);

    const geminiMimeType = upload.mimeType;
    const displayName = upload.filename;

    const CHUNK_SIZE = 32 * 1024 * 1024;
    const startUploadResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(fileSize),
          'X-Goog-Upload-Header-Content-Type': geminiMimeType,
        },
        body: JSON.stringify({
          file: { display_name: displayName },
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

    const readStream = fs.createReadStream(fileForGemini);
    let offset = 0;
    let currentChunk = Buffer.alloc(0);
    let finalizeResponseText: string | null = null;
    let streamFullyConsumed = false;

    const geminiProgressManager = new ProgressFlushManager(uploadId, {
      flushIntervalMs: 5000,
      minPctChange: 5,
    });

    for await (const data of readStream) {
      currentChunk = Buffer.concat([currentChunk, data as Buffer]);

      while (currentChunk.length >= CHUNK_SIZE) {
        const chunk = currentChunk.slice(0, CHUNK_SIZE);
        currentChunk = currentChunk.slice(CHUNK_SIZE);
        
        const isLast = offset + chunk.length >= fileSize;
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

        const responseText = await uploadResponse.text();
        
        if (!uploadResponse.ok) {
          throw new Error(`Chunk upload failed at offset ${offset}: ${responseText}`);
        }

        // Capture finalize response if this was the last chunk
        if (isLast) {
          finalizeResponseText = responseText;
        }

        offset += chunk.length;
        const transferPct = Math.floor((offset / fileSize) * 100);
        const overallPct = 5 + Math.floor(transferPct * 0.80);
        
        console.log(`[Upload] Gemini transfer ${uploadId}: ${transferPct}% (${Math.round(offset / 1024 / 1024)}MB / ${Math.round(fileSize / 1024 / 1024)}MB)`);
        
        geminiProgressManager.updateProgress({
          stage: 'transferring',
          pct: overallPct,
          message: `Sending to AI: ${transferPct}%`,
        });
      }
    }

    // Handle any remaining data that didn't fill a complete chunk
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

      const responseText = await uploadResponse.text();
      
      if (!uploadResponse.ok) {
        throw new Error(`Final chunk upload failed: ${responseText}`);
      }

      finalizeResponseText = responseText;
    }
    
    streamFullyConsumed = true;
    console.log(`[Upload] File stream fully consumed for ${uploadId}`);

    await geminiProgressManager.flushFinal();
    await writeMilestone(uploadId, 'GEMINI_UPLOAD_DONE');

    console.log(`[Upload] Gemini transfer ${uploadId}: 100% - upload complete, waiting for processing...`);

    // Parse finalize response to get Gemini file name
    // The response can have different structures depending on the API version
    let geminiFileName: string | null = null;
    
    if (finalizeResponseText && finalizeResponseText.trim()) {
      try {
        const result = JSON.parse(finalizeResponseText);
        // Check various possible response structures
        if (result.file?.name) {
          geminiFileName = result.file.name;
        } else if (result.name && result.name.startsWith('files/')) {
          geminiFileName = result.name;
        } else if (typeof result === 'object') {
          // Log the structure for debugging
          console.log(`[Upload] Finalize response structure:`, JSON.stringify(result).substring(0, 200));
        }
        
        if (geminiFileName) {
          console.log(`[Upload] Got Gemini file name from finalize response: ${geminiFileName}`);
        }
      } catch (e) {
        console.log(`[Upload] Finalize response not JSON: ${finalizeResponseText.substring(0, 100)}`);
      }
    } else {
      console.log(`[Upload] Finalize response was empty or whitespace`);
    }
    
    // If finalize didn't return file info, try the upload session query as fallback
    if (!geminiFileName) {
      console.log(`[Upload] Primary finalize response missing file info, trying session query...`);
      geminiFileName = await queryUploadSession(uploadUri, GEMINI_API_KEY);
    }
    
    if (!geminiFileName) {
      // This should not happen with a successful upload - indicates API behavior change
      console.error(`[Upload] CRITICAL: Gemini upload finalize did not return file info`);
      console.error(`[Upload] Finalize response: ${finalizeResponseText?.substring(0, 500)}`);
      throw new Error('Gemini upload completed but file info not returned. Please try again.');
    }
    
    await pollForActive(uploadId, geminiFileName, GEMINI_API_KEY);

    console.log(`[Upload] Successfully processed ${uploadId}, cleaning up temp files...`);

  } catch (error: any) {
    console.error(`[Upload] Processing error for ${uploadId}:`, error);
    await updateUploadError(uploadId, error.message || 'Processing failed');
  } finally {
    if (tempInputPath) cleanupTempFile(tempInputPath);
  }
}

async function queryUploadSession(uploadUri: string, apiKey: string): Promise<string | null> {
  try {
    // Query the resumable upload session to get file status
    // Using POST with query command as per Gemini resumable upload protocol
    const response = await fetch(uploadUri, {
      method: 'POST',
      headers: {
        'Content-Length': '0',
        'X-Goog-Upload-Command': 'query',
      },
    });
    
    const status = response.headers.get('X-Goog-Upload-Status');
    console.log(`[Upload] Upload session status: ${status} (HTTP ${response.status})`);
    
    if (status === 'final') {
      const responseText = await response.text();
      if (responseText && responseText.trim()) {
        try {
          const result = JSON.parse(responseText);
          if (result.file?.name) {
            console.log(`[Upload] Got file name from session query: ${result.file.name}`);
            return result.file.name;
          }
        } catch (e) {
          console.log(`[Upload] Session query response not parseable: ${responseText.substring(0, 50)}`);
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[Upload] Error querying upload session:`, error);
    return null;
  }
}

async function pollForActive(uploadId: string, geminiFileName: string, apiKey: string): Promise<void> {
  const maxAttempts = 90;
  const pollIntervalMs = 15000;
  const milestoneIntervalMs = 30000;
  let lastMilestoneUpdate = 0;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${apiKey}`
    );
    
    if (!response.ok) {
      console.log(`[Upload] Gemini file check failed (attempt ${attempt + 1}/${maxAttempts}), retrying...`);
      await new Promise(r => setTimeout(r, pollIntervalMs));
      continue;
    }

    const fileInfo = await response.json();
    
    if (fileInfo.state === 'ACTIVE') {
      await writeMilestone(uploadId, 'READY', {
        status: 'ACTIVE',
        extraFields: { geminiFileUri: fileInfo.uri },
      });
      
      console.log(`[Upload] ${uploadId} is now ACTIVE with URI: ${fileInfo.uri}`);
      return;
    }

    if (fileInfo.state === 'FAILED') {
      throw new Error('Gemini file processing failed');
    }

    const now = Date.now();
    if (now - lastMilestoneUpdate >= milestoneIntervalMs) {
      console.log(`[Upload] ${uploadId} state: ${fileInfo.state} (attempt ${attempt + 1}/${maxAttempts})`);
      await writeMilestone(uploadId, 'PROCESSING_ACTIVE');
      lastMilestoneUpdate = now;
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error('Timeout waiting for Gemini file to become active (22.5 min limit)');
}

async function updateUploadError(uploadId: string, error: string): Promise<void> {
  await writeMilestone(uploadId, 'JOB_FAILED', {
    status: 'FAILED',
    extraFields: { lastError: error },
  });
}

export default router;
