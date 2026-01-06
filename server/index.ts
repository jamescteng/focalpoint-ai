console.log('[FocalPoint] Server module loading...');

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import Busboy from 'busboy';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";
import { getPersonaById, getAllPersonas, PersonaConfig } from './personas.js';
import { storage } from './storage.js';

console.log('[FocalPoint] All imports successful');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? 5000 : 3001;

// Trust the first proxy (Replit / load balancer)
app.set('trust proxy', 1);

// =============================================================================
// Logging (defined early for use in security middleware)
// =============================================================================
const FocalPointLogger = {
  info: (stage: string, data: any) => console.log(`[FocalPoint][INFO][${stage}]`, data),
  warn: (stage: string, msg: string) => console.warn(`[FocalPoint][WARN][${stage}]`, msg),
  error: (stage: string, err: any) => console.error(`[FocalPoint][ERROR][${stage}]`, err)
};

// =============================================================================
// SECURITY: Input Validation Constants
// =============================================================================
const VALID_LANGUAGES = ['en', 'zh-TW'] as const;
const MAX_TITLE_LENGTH = 200;
const MAX_SYNOPSIS_LENGTH = 5000;
const MAX_SRT_LENGTH = 500000; // 500KB
const MAX_QUESTION_LENGTH = 500;
const MAX_QUESTIONS_COUNT = 10;
const ALLOWED_VIDEO_MIMES = [
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/mpeg', 'video/ogg', 'video/3gpp', 'video/3gpp2'
];

// =============================================================================
// SECURITY: Rate Limiting
// =============================================================================
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 2, // 2 uploads per minute per IP
  message: { error: 'Too many upload requests. Please wait before uploading again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 analyze requests per minute per IP
  message: { error: 'Too many analysis requests. Please wait before analyzing again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 status/poll requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// =============================================================================
// SECURITY: CORS Configuration
// =============================================================================
console.log('[FocalPoint] Configuring middleware...');

const allowedOrigins = isProduction
  ? [process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER?.toLowerCase()}.repl.co` : '']
  : ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://0.0.0.0:5000'];

// In production, also allow the replit.dev domain
if (isProduction && process.env.REPLIT_DEV_DOMAIN) {
  allowedOrigins.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc) in development only
    if (!origin) {
      return callback(null, !isProduction);
    }
    
    // Always allow Replit domains (both dev and production on Replit)
    if (origin.endsWith('.repl.co') || origin.endsWith('.replit.dev') || origin.endsWith('.replit.app')) {
      return callback(null, true);
    }
    
    // Allow localhost in development
    if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(origin)) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    FocalPointLogger.warn('CORS', `Blocked request from origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const jsonParser = express.json({ limit: '50mb' });
app.use((req, res, next) => {
  if (req.path === '/api/upload') {
    return next();
  }
  return jsonParser(req, res, next);
});

app.get('/api/health', statusLimiter, (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api/upload', (req, res, next) => {
  req.setTimeout(600000);
  res.setTimeout(600000);
  next();
});

const logMem = (tag: string) => {
  const m = process.memoryUsage();
  console.log(`[FocalPoint][MEM][${tag}]`, {
    rss: Math.round(m.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(m.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(m.heapTotal / 1024 / 1024) + 'MB',
  });
};

const MAX_VIDEO_SIZE_MB = 2000;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

const MAX_WAIT_MS = 10 * 60 * 1000;
const INITIAL_DELAY_MS = 1000;
const BACKOFF_FACTOR = 1.5;
const MAX_DELAY_MS = 10_000;
const JITTER_RATIO = 0.2;

function sleepWithJitter(baseDelayMs: number): Promise<void> {
  const jitter = baseDelayMs * JITTER_RATIO * (Math.random() * 2 - 1);
  const delay = Math.max(500, baseDelayMs + jitter);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Streaming upload - no longer using multer for disk buffering

if (isProduction) {
  app.use(express.static(path.join(__dirname, '../dist')));
}

interface AnalyzeRequest {
  title: string;
  synopsis: string;
  srtContent: string;
  questions: string[];
  language: 'en' | 'zh-TW';
  fileUri: string;
  fileMimeType: string;
  personaIds: string[];
}

const safeParseReport = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch (e) {
    FocalPointLogger.warn("Parsing", "Response not pure JSON. Attempting structural extraction.");
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.substring(start, end + 1));
    }
    throw new Error("PARSE_ERR: Model response format incompatible with internal schema.");
  }
};

const getApiKey = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Server configuration error: API key not set.");
  }
  return apiKey;
};

const getAI = () => {
  return new GoogleGenAI({ apiKey: getApiKey() });
};

async function uploadFileWithResumable(filePath: string, mimeType: string, displayName: string): Promise<{ name: string; uri: string }> {
  const apiKey = getApiKey();
  const fileSize = fs.statSync(filePath).size;
  const CHUNK_GRANULARITY = 256 * 1024;
  const CHUNK_SIZE = 16 * 1024 * 1024;
  
  FocalPointLogger.info("Resumable_Init", { fileSize, mimeType, displayName });

  const initResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": fileSize.toString(),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { displayName }
      }),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Failed to initialize resumable upload: ${initResponse.status} - ${errorText}`);
  }

  const uploadUrl = initResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Failed to get resumable upload URL from response headers");
  }

  FocalPointLogger.info("Resumable_URL", "Got upload URL, starting chunked upload...");

  let offset = 0;
  const fd = fs.openSync(filePath, 'r');
  let finalResult: any = null;

  try {
    while (offset < fileSize) {
      const remainingBytes = fileSize - offset;
      const isLastChunk = remainingBytes <= CHUNK_SIZE;
      
      let currentChunkSize: number;
      if (isLastChunk) {
        currentChunkSize = remainingBytes;
      } else {
        currentChunkSize = Math.floor(CHUNK_SIZE / CHUNK_GRANULARITY) * CHUNK_GRANULARITY;
      }
      
      const buffer = Buffer.alloc(currentChunkSize);
      fs.readSync(fd, buffer, 0, currentChunkSize, offset);

      const progressPercent = Math.round(((offset + currentChunkSize) / fileSize) * 100);
      FocalPointLogger.info("Chunk_Upload", `Uploading ${isLastChunk ? 'final ' : ''}chunk: ${progressPercent}% (${((offset + currentChunkSize) / 1024 / 1024).toFixed(1)}MB / ${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

      const uploadCommand = isLastChunk ? "upload, finalize" : "upload";
      
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Length": currentChunkSize.toString(),
          "X-Goog-Upload-Offset": offset.toString(),
          "X-Goog-Upload-Command": uploadCommand,
        },
        body: buffer,
      });

      const sizeReceived = uploadResponse.headers.get("x-goog-upload-size-received");
      const uploadStatus = uploadResponse.headers.get("x-goog-upload-status");
      
      if (isLastChunk) {
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(`Final chunk upload failed: ${uploadResponse.status} - ${errorText}`);
        }
        const responseText = await uploadResponse.text();
        if (responseText && responseText.trim()) {
          try {
            finalResult = JSON.parse(responseText);
            FocalPointLogger.info("Upload_Finalized", { fileName: finalResult.file?.name, status: uploadStatus });
          } catch (e) {
            FocalPointLogger.warn("Parse_Warning", `Could not parse final response: ${responseText.substring(0, 100)}`);
          }
        }
        
        if (!finalResult?.file) {
          const uploadResultHeader = uploadResponse.headers.get("x-goog-upload-result");
          if (uploadResultHeader) {
            try {
              finalResult = JSON.parse(uploadResultHeader);
              FocalPointLogger.info("Upload_From_Header", { fileName: finalResult.file?.name });
            } catch (e) {
              FocalPointLogger.warn("Header_Parse", `Could not parse X-Goog-Upload-Result header`);
            }
          }
        }
        
        if (!finalResult?.file && uploadStatus === "final") {
          FocalPointLogger.info("List_Files", "Fetching recent files to find upload...");
          const filesResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}&pageSize=10`,
            { method: "GET" }
          );
          if (filesResponse.ok) {
            const filesData = await filesResponse.json();
            const matchingFile = filesData.files?.find((f: any) => 
              f.displayName === displayName && f.sizeBytes === fileSize.toString()
            );
            if (matchingFile) {
              finalResult = { file: matchingFile };
              FocalPointLogger.info("Upload_From_List", { fileName: matchingFile.name });
            }
          }
        }
      } else {
        if (uploadResponse.status !== 200 && uploadResponse.status !== 308) {
          const errorText = await uploadResponse.text();
          throw new Error(`Chunk upload failed: ${uploadResponse.status} - ${errorText}`);
        }
        
        let serverOffset: number | null = null;
        
        if (sizeReceived) {
          serverOffset = parseInt(sizeReceived, 10);
        } else {
          const rangeHeader = uploadResponse.headers.get("range");
          if (rangeHeader) {
            const match = rangeHeader.match(/bytes=0-(\d+)/);
            if (match) {
              serverOffset = parseInt(match[1], 10) + 1;
            }
          }
        }
        
        if (serverOffset !== null && serverOffset !== offset + currentChunkSize) {
          FocalPointLogger.warn("Offset_Mismatch", `Expected ${offset + currentChunkSize}, server received ${serverOffset}. Realigning.`);
          offset = serverOffset;
          continue;
        }
      }

      offset += currentChunkSize;
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!finalResult?.file) {
    throw new Error("Upload completed but could not retrieve file info from response");
  }

  return {
    name: finalResult.file.name,
    uri: finalResult.file.uri
  };
}

interface StreamingUploadState {
  bytesReceived: number;
  bytesAckedToGemini: number;
  uploadUrl: string | null;
  spoolPath: string;
  spoolFd: number | null;
  geminiOffset: number;
  fileSize: number;
  mimeType: string;
  displayName: string;
}

// =============================================================================
// ASYNC UPLOAD JOB STORE
// =============================================================================
type UploadJobStatus = 'RECEIVED' | 'SPOOLING' | 'UPLOADING' | 'PROCESSING' | 'ACTIVE' | 'ERROR';

interface UploadJob {
  id: string;
  attemptId?: string;
  status: UploadJobStatus;
  progress: number;
  fileUri?: string;
  fileMimeType?: string;
  fileName?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const uploadJobs = new Map<string, UploadJob>();
const attemptIdToJobId = new Map<string, string>();

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
const ATTEMPT_ID_PATTERN = /^attempt_\d+_[a-z0-9]+$/;

function isValidAttemptId(attemptId: string): boolean {
  return ATTEMPT_ID_PATTERN.test(attemptId) && attemptId.length >= 15 && attemptId.length <= 50;
}

function generateJobId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getJobByAttemptId(attemptId: string): UploadJob | undefined {
  const jobId = attemptIdToJobId.get(attemptId);
  if (jobId) {
    return uploadJobs.get(jobId);
  }
  return undefined;
}

function createJob(attemptId?: string): UploadJob {
  const job: UploadJob = {
    id: generateJobId(),
    attemptId,
    status: 'RECEIVED',
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  uploadJobs.set(job.id, job);
  if (attemptId) {
    attemptIdToJobId.set(attemptId, job.id);
  }
  return job;
}

function updateJob(jobId: string, updates: Partial<UploadJob>): void {
  const job = uploadJobs.get(jobId);
  if (job) {
    Object.assign(job, updates, { updatedAt: Date.now() });
  }
}

function cleanupOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of uploadJobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      uploadJobs.delete(id);
      if (job.attemptId) {
        attemptIdToJobId.delete(job.attemptId);
      }
    }
  }
}

setInterval(cleanupOldJobs, 5 * 60 * 1000);

async function processUploadInBackground(
  jobId: string,
  spoolPath: string,
  mimeType: string,
  displayName: string,
  fileSize: number
): Promise<void> {
  try {
    updateJob(jobId, { status: 'UPLOADING', progress: 5 });
    
    const uploadUrl = await initGeminiResumableSession(fileSize, mimeType, displayName);
    
    const uploadResult = await uploadFromSpoolFileWithProgress(
      spoolPath,
      uploadUrl,
      0,
      fileSize,
      (progress) => updateJob(jobId, { progress: 5 + Math.round(progress * 0.6) })
    );
    
    updateJob(jobId, { 
      status: 'PROCESSING', 
      progress: 70,
      fileName: uploadResult.name 
    });
    
    FocalPointLogger.info("Background_Upload_Complete", { name: uploadResult.name, uri: uploadResult.uri });
    
    const ai = getAI();
    let fileInfo = await ai.files.get({ name: uploadResult.name });

    if (fileInfo.state === "FAILED") {
      const errorMsg = (fileInfo as any).error?.message ?? "unknown error";
      FocalPointLogger.error("Background_Processing_Failed", errorMsg);
      updateJob(jobId, { status: 'ERROR', error: "Video processing failed. Please try a different video format." });
      fs.unlink(spoolPath, () => {});
      return;
    }

    const startTime = Date.now();
    let attempt = 0;
    let delayMs = INITIAL_DELAY_MS;

    while (fileInfo.state === "PROCESSING") {
      const elapsedMs = Date.now() - startTime;

      if (elapsedMs > MAX_WAIT_MS) {
        FocalPointLogger.warn("Background_Processing_Timeout", `Timed out after ${Math.round(elapsedMs / 1000)}s`);
        updateJob(jobId, { status: 'ERROR', error: "Video processing timed out. Please try a shorter or smaller video." });
        fs.unlink(spoolPath, () => {});
        return;
      }

      FocalPointLogger.info(
        "Background_Processing",
        `Waiting for video processing… attempt=${attempt + 1}, elapsed=${Math.round(elapsedMs / 1000)}s`
      );
      
      const processingProgress = Math.min(95, 70 + Math.round((elapsedMs / MAX_WAIT_MS) * 25));
      updateJob(jobId, { progress: processingProgress });

      await sleepWithJitter(delayMs);

      fileInfo = await ai.files.get({ name: uploadResult.name });

      if (fileInfo.state === "FAILED") {
        const errorMsg = (fileInfo as any).error?.message ?? "unknown error";
        FocalPointLogger.error("Background_Processing_Failed", errorMsg);
        updateJob(jobId, { status: 'ERROR', error: "Video processing failed. Please try a different video format." });
        fs.unlink(spoolPath, () => {});
        return;
      }

      delayMs = Math.min(delayMs * BACKOFF_FACTOR, MAX_DELAY_MS);
      attempt++;
    }

    fs.unlink(spoolPath, () => {});

    FocalPointLogger.info("Background_Processing_Complete", { state: fileInfo.state });
    
    updateJob(jobId, {
      status: 'ACTIVE',
      progress: 100,
      fileUri: fileInfo.uri,
      fileMimeType: mimeType,
      fileName: uploadResult.name
    });

  } catch (error: any) {
    FocalPointLogger.error("Background_Upload_Error", error.message);
    updateJob(jobId, { status: 'ERROR', error: error.message || "Upload failed. Please try again." });
    fs.unlink(spoolPath, () => {});
  }
}

async function uploadFromSpoolFileWithProgress(
  spoolPath: string,
  uploadUrl: string,
  startOffset: number,
  totalSize: number,
  onProgress?: (progress: number) => void
): Promise<{ name: string; uri: string }> {
  const CHUNK_SIZE = 16 * 1024 * 1024;
  const CHUNK_GRANULARITY = 256 * 1024;
  
  FocalPointLogger.info("Spool_Resume", { startOffset, totalSize, spoolPath });
  
  let offset = startOffset;
  const fd = fs.openSync(spoolPath, 'r');
  let finalResult: any = null;

  try {
    while (offset < totalSize) {
      const remainingBytes = totalSize - offset;
      const isLastChunk = remainingBytes <= CHUNK_SIZE;
      
      let currentChunkSize: number;
      if (isLastChunk) {
        currentChunkSize = remainingBytes;
      } else {
        currentChunkSize = Math.floor(CHUNK_SIZE / CHUNK_GRANULARITY) * CHUNK_GRANULARITY;
      }
      
      const buffer = Buffer.alloc(currentChunkSize);
      fs.readSync(fd, buffer, 0, currentChunkSize, offset);

      const progressPercent = (offset + currentChunkSize) / totalSize;
      FocalPointLogger.info("Spool_Chunk", `Uploading from spool: ${Math.round(progressPercent * 100)}%`);
      onProgress?.(progressPercent);

      const result = await uploadChunkToGemini(uploadUrl, buffer, offset, isLastChunk, totalSize);
      
      if (result.finalResult?.file) {
        finalResult = result.finalResult;
      }
      
      offset = result.newOffset;
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!finalResult?.file) {
    throw new Error("Spool upload completed but could not retrieve file info");
  }

  return {
    name: finalResult.file.name,
    uri: finalResult.file.uri
  };
}

async function initGeminiResumableSession(
  fileSize: number,
  mimeType: string,
  displayName: string
): Promise<string> {
  const apiKey = getApiKey();
  
  FocalPointLogger.info("Resumable_Init", { fileSize, mimeType, displayName });

  const initResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": fileSize.toString(),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { displayName }
      }),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Failed to initialize resumable upload: ${initResponse.status} - ${errorText}`);
  }

  const uploadUrl = initResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Failed to get resumable upload URL from response headers");
  }

  FocalPointLogger.info("Resumable_URL", "Got upload URL for streaming upload");
  return uploadUrl;
}

async function uploadChunkToGemini(
  uploadUrl: string,
  chunk: Buffer,
  offset: number,
  isLastChunk: boolean,
  totalSize: number
): Promise<{ newOffset: number; finalResult?: any }> {
  const uploadCommand = isLastChunk ? "upload, finalize" : "upload";
  
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": chunk.length.toString(),
      "X-Goog-Upload-Offset": offset.toString(),
      "X-Goog-Upload-Command": uploadCommand,
    },
    body: chunk,
  });

  const sizeReceived = uploadResponse.headers.get("x-goog-upload-size-received");
  const uploadStatus = uploadResponse.headers.get("x-goog-upload-status");

  if (isLastChunk) {
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Final chunk upload failed: ${uploadResponse.status} - ${errorText}`);
    }
    
    let finalResult: any = null;
    const responseText = await uploadResponse.text();
    if (responseText && responseText.trim()) {
      try {
        finalResult = JSON.parse(responseText);
        FocalPointLogger.info("Upload_Finalized", { fileName: finalResult.file?.name, status: uploadStatus });
      } catch (e) {
        FocalPointLogger.warn("Parse_Warning", `Could not parse final response`);
      }
    }
    
    return { newOffset: offset + chunk.length, finalResult };
  } else {
    if (uploadResponse.status !== 200 && uploadResponse.status !== 308) {
      const errorText = await uploadResponse.text();
      throw new Error(`Chunk upload failed: ${uploadResponse.status} - ${errorText}`);
    }
    
    let serverOffset = offset + chunk.length;
    if (sizeReceived) {
      serverOffset = parseInt(sizeReceived, 10);
    }
    
    return { newOffset: serverOffset };
  }
}

async function uploadFromSpoolFile(
  spoolPath: string,
  uploadUrl: string,
  startOffset: number,
  totalSize: number
): Promise<{ name: string; uri: string }> {
  const CHUNK_SIZE = 16 * 1024 * 1024;
  const CHUNK_GRANULARITY = 256 * 1024;
  
  FocalPointLogger.info("Spool_Resume", { startOffset, totalSize, spoolPath });
  
  let offset = startOffset;
  const fd = fs.openSync(spoolPath, 'r');
  let finalResult: any = null;

  try {
    while (offset < totalSize) {
      const remainingBytes = totalSize - offset;
      const isLastChunk = remainingBytes <= CHUNK_SIZE;
      
      let currentChunkSize: number;
      if (isLastChunk) {
        currentChunkSize = remainingBytes;
      } else {
        currentChunkSize = Math.floor(CHUNK_SIZE / CHUNK_GRANULARITY) * CHUNK_GRANULARITY;
      }
      
      const buffer = Buffer.alloc(currentChunkSize);
      fs.readSync(fd, buffer, 0, currentChunkSize, offset);

      const progressPercent = Math.round(((offset + currentChunkSize) / totalSize) * 100);
      FocalPointLogger.info("Spool_Chunk", `Uploading from spool: ${progressPercent}%`);

      const result = await uploadChunkToGemini(uploadUrl, buffer, offset, isLastChunk, totalSize);
      
      if (result.finalResult?.file) {
        finalResult = result.finalResult;
      }
      
      offset = result.newOffset;
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!finalResult?.file) {
    throw new Error("Spool upload completed but could not retrieve file info");
  }

  return {
    name: finalResult.file.name,
    uri: finalResult.file.uri
  };
}

app.post('/api/upload', uploadLimiter, async (req, res) => {
  logMem('upload_start');
  
  const attemptId = req.headers['x-upload-attempt-id'] as string | undefined;
  const requestId = req.headers['x-request-id'] as string | undefined;
  
  FocalPointLogger.info("Upload_Request", { attemptId, requestId });
  
  if (!attemptId) {
    FocalPointLogger.warn("Upload_MissingAttemptId", "X-Upload-Attempt-Id header is required");
    return res.status(400).json({ error: "X-Upload-Attempt-Id header is required." });
  }
  
  if (!isValidAttemptId(attemptId)) {
    FocalPointLogger.warn("Upload_InvalidAttemptId", `Invalid attemptId: ${attemptId}`);
    return res.status(400).json({ error: "Invalid X-Upload-Attempt-Id format." });
  }
  
  const existingJob = getJobByAttemptId(attemptId);
  if (existingJob) {
    FocalPointLogger.info("Upload_Dedupe", { 
      attemptId, 
      existingJobId: existingJob.id, 
      status: existingJob.status 
    });
    return res.json({ 
      jobId: existingJob.id, 
      status: existingJob.status,
      message: 'Upload already in progress for this attempt'
    });
  }
  
  const job = createJob(attemptId);
  let spoolPath: string | null = null;
  let spoolWriteStream: fs.WriteStream | null = null;
  let fileMimeType: string = '';
  let fileDisplayName: string = '';
  let totalBytesReceived: number = 0;
  
  try {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      updateJob(job.id, { status: 'ERROR', error: "Invalid request format." });
      return res.status(400).json({ error: "Invalid request format. Expected multipart/form-data." });
    }

    const busboy = Busboy({ 
      headers: req.headers,
      limits: { fileSize: MAX_VIDEO_SIZE_BYTES }
    });

    let fileProcessed = false;
    let uploadError: Error | null = null;
    let spoolResult: { spoolPath: string; fileSize: number; mimeType: string; displayName: string } | null = null;
    
    let resolveSpoolCompletion: () => void;
    let rejectSpoolCompletion: (err: Error) => void;
    const spoolCompletionPromise = new Promise<void>((resolve, reject) => {
      resolveSpoolCompletion = resolve;
      rejectSpoolCompletion = reject;
    });

    const busboyFinishPromise = new Promise<void>((resolve, reject) => {
      busboy.on('file', async (fieldname, fileStream, info) => {
        if (fieldname !== 'video') {
          fileStream.resume();
          return;
        }

        fileProcessed = true;
        const { filename, mimeType } = info;
        fileMimeType = mimeType;
        fileDisplayName = filename || 'video';

        if (!ALLOWED_VIDEO_MIMES.includes(mimeType) && !mimeType.startsWith('video/')) {
          FocalPointLogger.warn("Upload_Rejected", `Invalid MIME type: ${mimeType}`);
          uploadError = new Error("Invalid file type. Only video files are accepted.");
          fileStream.resume();
          resolveSpoolCompletion();
          return;
        }

        FocalPointLogger.info("Stream_Start", { filename, mimeType, attemptId, jobId: job.id });
        updateJob(job.id, { status: 'SPOOLING', progress: 1 });

        spoolPath = path.join(os.tmpdir(), `focalpoint-spool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        spoolWriteStream = fs.createWriteStream(spoolPath, { highWaterMark: 16 * 1024 * 1024 });

        let bytesReceived = 0;
        let spoolError: Error | null = null;

        spoolWriteStream.on('error', (err) => {
          FocalPointLogger.error("Spool_Write_Error", err);
          spoolError = err;
          fileStream.destroy(err);
        });

        spoolWriteStream.on('drain', () => {
          fileStream.resume();
        });

        fileStream.on('data', (chunk: Buffer) => {
          if (spoolError) return;
          
          bytesReceived += chunk.length;
          totalBytesReceived = bytesReceived;
          const canContinue = spoolWriteStream!.write(chunk);
          
          if (!canContinue) {
            fileStream.pause();
          }
          
          if (bytesReceived % (50 * 1024 * 1024) < chunk.length) {
            FocalPointLogger.info("Stream_Progress", { 
              bytesReceived: Math.round(bytesReceived / 1024 / 1024) + 'MB'
            });
          }
        });

        fileStream.on('end', async () => {
          if (spoolError || uploadError) {
            if (spoolWriteStream) {
              spoolWriteStream.destroy();
            }
            resolveSpoolCompletion();
            return;
          }
          
          try {
            await new Promise<void>((resolveWrite, rejectWrite) => {
              spoolWriteStream!.end(() => resolveWrite());
              spoolWriteStream!.once('error', rejectWrite);
            });
            
            FocalPointLogger.info("Spool_Complete", { totalBytes: bytesReceived, spoolPath });
            
            spoolResult = {
              spoolPath: spoolPath!,
              fileSize: bytesReceived,
              mimeType,
              displayName: fileDisplayName
            };
            
            resolveSpoolCompletion();
            
          } catch (err: any) {
            FocalPointLogger.error("Spool_Error", err.message);
            uploadError = err;
            resolveSpoolCompletion();
          }
        });

        fileStream.on('error', (err) => {
          FocalPointLogger.error("Stream_Error", err);
          uploadError = err;
          resolveSpoolCompletion();
        });

        fileStream.on('limit', () => {
          FocalPointLogger.warn("Stream_Limit", `File exceeded ${MAX_VIDEO_SIZE_MB}MB limit`);
          uploadError = new Error(`File too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB.`);
        });
      });

      busboy.on('finish', () => {
        FocalPointLogger.info("Busboy_Finish", "HTTP request body fully consumed");
        if (!fileProcessed) {
          resolveSpoolCompletion();
          reject(new Error("No video file provided."));
        } else {
          resolve();
        }
      });

      busboy.on('error', (err) => {
        FocalPointLogger.error("Busboy_Error", err);
        reject(err);
      });
    });

    req.pipe(busboy);
    
    await busboyFinishPromise;
    await spoolCompletionPromise;
    
    FocalPointLogger.info("Upload_FullyConsumed", "HTTP request body and spool file complete");

    if (uploadError) {
      if (spoolPath) fs.unlink(spoolPath, () => {});
      const isValidationError = uploadError.message.includes("Invalid file type") || 
                                 uploadError.message.includes("too large");
      const statusCode = isValidationError ? 400 : 500;
      updateJob(job.id, { status: 'ERROR', error: uploadError.message });
      return res.status(statusCode).json({ error: uploadError.message });
    }

    if (!spoolResult) {
      if (spoolPath) fs.unlink(spoolPath, () => {});
      updateJob(job.id, { status: 'ERROR', error: "Upload failed." });
      return res.status(500).json({ error: "Upload failed. Please try again." });
    }

    FocalPointLogger.info("Upload_Received", { 
      jobId: job.id, 
      fileSize: spoolResult.fileSize,
      mimeType: spoolResult.mimeType 
    });

    updateJob(job.id, { 
      status: 'RECEIVED', 
      progress: 3,
      fileMimeType: spoolResult.mimeType
    });

    processUploadInBackground(
      job.id,
      spoolResult.spoolPath,
      spoolResult.mimeType,
      spoolResult.displayName,
      spoolResult.fileSize
    ).catch(err => {
      FocalPointLogger.error("Background_Process_Uncaught", err);
    });

    res.json({
      jobId: job.id,
      status: 'RECEIVED'
    });

  } catch (error: any) {
    logMem('upload_error');
    FocalPointLogger.error("Upload", error);
    if (spoolPath) fs.unlink(spoolPath, () => {});
    updateJob(job.id, { status: 'ERROR', error: "Upload failed. Please try again." });
    res.status(500).json({ error: "Upload failed. Please try again." });
  }
});

app.get('/api/upload/status/:jobId', statusLimiter, (req, res) => {
  const { jobId } = req.params;
  const job = uploadJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: "Upload job not found." });
  }
  
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    fileUri: job.fileUri || null,
    fileMimeType: job.fileMimeType || null,
    fileName: job.fileName || null,
    error: job.error || null
  });
});

app.get('/api/personas', statusLimiter, (req, res) => {
  const personas = getAllPersonas().map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    avatar: p.avatar,
    demographics: p.demographics,
    highlightCategories: p.highlightCategories,
    concernCategories: p.concernCategories
  }));
  res.json(personas);
});

app.post('/api/sessions', statusLimiter, async (req, res) => {
  try {
    const { title, synopsis, questions, language, fileUri, fileMimeType, fileName } = req.body;
    
    if (!title || typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: 'Invalid title.' });
    }
    
    const session = await storage.createSession({
      title: title.trim(),
      synopsis: synopsis?.trim() || '',
      questions: Array.isArray(questions) ? questions.slice(0, MAX_QUESTIONS_COUNT) : [],
      language: VALID_LANGUAGES.includes(language) ? language : 'en',
      fileUri: fileUri || null,
      fileMimeType: fileMimeType || null,
      fileName: fileName || null,
    });
    
    FocalPointLogger.info("Session_Created", { sessionId: session.id });
    res.json(session);
  } catch (error: any) {
    FocalPointLogger.error("Session_Create", error.message);
    res.status(500).json({ error: 'Failed to create session.' });
  }
});

app.get('/api/sessions', statusLimiter, async (req, res) => {
  try {
    const sessions = await storage.getSessions();
    res.json(sessions);
  } catch (error: any) {
    FocalPointLogger.error("Sessions_List", error.message);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

app.get('/api/sessions/:id', statusLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const session = await storage.getSession(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    
    res.json(session);
  } catch (error: any) {
    FocalPointLogger.error("Session_Get", error.message);
    res.status(500).json({ error: 'Failed to load session.' });
  }
});

app.put('/api/sessions/:id', statusLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const { fileUri, fileMimeType, fileName } = req.body;
    
    const session = await storage.updateSession(id, {
      fileUri,
      fileMimeType,
      fileName,
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    
    FocalPointLogger.info("Session_Updated", { sessionId: session.id });
    res.json(session);
  } catch (error: any) {
    FocalPointLogger.error("Session_Update", error.message);
    res.status(500).json({ error: 'Failed to update session.' });
  }
});

app.delete('/api/sessions/:id', statusLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    await storage.deleteSession(id);
    FocalPointLogger.info("Session_Deleted", { sessionId: id });
    res.json({ success: true });
  } catch (error: any) {
    FocalPointLogger.error("Session_Delete", error.message);
    res.status(500).json({ error: 'Failed to delete session.' });
  }
});

app.get('/api/sessions/:id/reports', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const reports = await storage.getReportsBySession(sessionId);
    res.json(reports);
  } catch (error: any) {
    FocalPointLogger.error("Reports_List", error.message);
    res.status(500).json({ error: 'Failed to load reports.' });
  }
});

app.post('/api/sessions/:id/reports', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const { personaId, executiveSummary, highlights, concerns, answers, validationWarnings } = req.body;
    
    if (!personaId || !executiveSummary) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    
    const report = await storage.createReport({
      sessionId,
      personaId,
      executiveSummary,
      highlights: highlights || [],
      concerns: concerns || [],
      answers: answers || [],
      validationWarnings: validationWarnings || [],
    });
    
    FocalPointLogger.info("Report_Created", { reportId: report.id, sessionId, personaId });
    res.json(report);
  } catch (error: any) {
    FocalPointLogger.error("Report_Create", error.message);
    res.status(500).json({ error: 'Failed to save report.' });
  }
});

async function analyzeWithPersona(
  ai: any,
  persona: PersonaConfig,
  params: {
    title: string;
    synopsis: string;
    srtContent: string;
    questions: string[];
    langName: string;
    fileUri: string;
    fileMimeType: string;
  }
): Promise<{ personaId: string; status: 'success' | 'error'; report?: any; error?: string; validationWarnings?: string[] }> {
  const modelName = "gemini-3-flash-preview";
  
  try {
    const systemInstruction = persona.systemInstruction(params.langName);
    const userPrompt = persona.userPrompt({
      title: params.title,
      synopsis: params.synopsis,
      srtContent: params.srtContent,
      questions: params.questions,
      langName: params.langName
    });

    FocalPointLogger.info("API_Call", { model: modelName, persona: persona.id, fileUri: params.fileUri });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          createPartFromUri(params.fileUri, params.fileMimeType || 'video/mp4'),
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executive_summary: { type: Type.STRING },
            highlights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  timestamp: { type: Type.STRING },
                  seconds: { type: Type.NUMBER },
                  summary: { type: Type.STRING },
                  why_it_works: { type: Type.STRING },
                  category: { type: Type.STRING, enum: persona.highlightCategories }
                },
                required: ["timestamp", "seconds", "summary", "why_it_works", "category"]
              }
            },
            concerns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  timestamp: { type: Type.STRING },
                  seconds: { type: Type.NUMBER },
                  issue: { type: Type.STRING },
                  impact: { type: Type.STRING },
                  severity: { type: Type.NUMBER },
                  category: { type: Type.STRING, enum: persona.concernCategories },
                  suggested_fix: { type: Type.STRING }
                },
                required: ["timestamp", "seconds", "issue", "impact", "severity", "category", "suggested_fix"]
              }
            },
            answers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  answer: { type: Type.STRING }
                },
                required: ["question", "answer"]
              }
            }
          },
          required: ["executive_summary", "highlights", "concerns", "answers"]
        }
      }
    });

    const report = safeParseReport(response.text || "{}");
    FocalPointLogger.info("API_Success", { persona: persona.id });

    const validationWarnings: string[] = [];
    
    if (!report.highlights || !Array.isArray(report.highlights)) {
      report.highlights = [];
      validationWarnings.push("Missing highlights array");
    }
    if (!report.concerns || !Array.isArray(report.concerns)) {
      report.concerns = [];
      validationWarnings.push("Missing concerns array");
    }
    
    if (report.highlights.length !== 5) {
      validationWarnings.push(`Expected 5 highlights, got ${report.highlights.length}`);
    }
    if (report.concerns.length !== 5) {
      validationWarnings.push(`Expected 5 concerns, got ${report.concerns.length}`);
    }
    
    let missingSeverityCount = 0;
    let clampedSeverityCount = 0;
    
    const genuineHighSeverityCount = report.concerns.filter((c: any) => {
      const s = c.severity;
      return s !== undefined && s !== null && typeof s === 'number' && !isNaN(s) && s >= 3 && s <= 5;
    }).length;
    
    report.concerns = report.concerns.map((c: any) => {
      const rawSeverity = c.severity;
      let validatedSeverity: number;
      
      if (rawSeverity === undefined || rawSeverity === null || typeof rawSeverity !== 'number' || isNaN(rawSeverity)) {
        missingSeverityCount++;
        validatedSeverity = 3;
      } else if (rawSeverity < 1 || rawSeverity > 5) {
        clampedSeverityCount++;
        validatedSeverity = Math.max(1, Math.min(5, Math.round(rawSeverity)));
      } else {
        validatedSeverity = Math.round(rawSeverity);
      }
      
      return { ...c, severity: validatedSeverity };
    });
    
    if (missingSeverityCount > 0) {
      validationWarnings.push(`${missingSeverityCount} concerns had missing/invalid severity (defaulted to 3)`);
    }
    if (clampedSeverityCount > 0) {
      validationWarnings.push(`${clampedSeverityCount} concerns had severity outside 1-5 range (clamped)`);
    }
    
    if (genuineHighSeverityCount < persona.minHighSeverityConcerns) {
      validationWarnings.push(`Expected at least ${persona.minHighSeverityConcerns} concerns with severity >= 3, got ${genuineHighSeverityCount}`);
    }
    
    if (validationWarnings.length > 0) {
      FocalPointLogger.warn("Validation", `[${persona.id}] ${validationWarnings.join("; ")}`);
    }

    return {
      personaId: persona.id,
      status: 'success',
      report: {
        executive_summary: report.executive_summary,
        highlights: report.highlights,
        concerns: report.concerns,
        answers: report.answers
      },
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined
    };
  } catch (error: any) {
    FocalPointLogger.error("API_Call", `[${persona.id}] ${error.message}`);
    return {
      personaId: persona.id,
      status: 'error' as const,
      error: error.message
    };
  }
}

app.post('/api/analyze', analyzeLimiter, async (req, res) => {
  try {
    const { title, synopsis, srtContent, questions, language, fileUri, fileMimeType, personaIds } = req.body as AnalyzeRequest;

    // ==========================================================================
    // SECURITY: Input Validation
    // ==========================================================================
    
    // Validate title
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required." });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Title too long. Maximum ${MAX_TITLE_LENGTH} characters.` });
    }

    // Validate synopsis
    if (synopsis && synopsis.length > MAX_SYNOPSIS_LENGTH) {
      return res.status(400).json({ error: `Synopsis too long. Maximum ${MAX_SYNOPSIS_LENGTH} characters.` });
    }

    // Validate SRT content
    if (srtContent && srtContent.length > MAX_SRT_LENGTH) {
      return res.status(400).json({ error: `Subtitle content too large. Maximum ${MAX_SRT_LENGTH / 1000}KB.` });
    }

    // Validate questions
    if (questions) {
      if (!Array.isArray(questions)) {
        return res.status(400).json({ error: "Questions must be an array." });
      }
      if (questions.length > MAX_QUESTIONS_COUNT) {
        return res.status(400).json({ error: `Too many questions. Maximum ${MAX_QUESTIONS_COUNT}.` });
      }
      for (const q of questions) {
        if (typeof q !== 'string' || q.length > MAX_QUESTION_LENGTH) {
          return res.status(400).json({ error: `Each question must be a string under ${MAX_QUESTION_LENGTH} characters.` });
        }
      }
    }

    // Validate language
    if (language && !VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: "Invalid language. Supported: en, zh-TW." });
    }

    // Validate fileUri format (basic check for Gemini URI)
    if (!fileUri) {
      return res.status(400).json({ error: "Video file URI is required. Please upload a video first." });
    }
    if (!fileUri.startsWith('https://generativelanguage.googleapis.com/')) {
      FocalPointLogger.warn("Validation", `Suspicious fileUri: ${fileUri.substring(0, 50)}`);
      return res.status(400).json({ error: "Invalid file URI format." });
    }

    // Validate personaIds against registry
    const allPersonaIds = getAllPersonas().map(p => p.id);
    const selectedPersonaIds = personaIds && personaIds.length > 0 ? personaIds : ['acquisitions_director'];
    
    for (const id of selectedPersonaIds) {
      if (typeof id !== 'string' || !allPersonaIds.includes(id)) {
        return res.status(400).json({ error: `Invalid persona: ${id}` });
      }
    }

    const personas = selectedPersonaIds.map(id => getPersonaById(id)).filter((p): p is PersonaConfig => p !== undefined);

    if (personas.length === 0) {
      return res.status(400).json({ error: "No valid personas selected." });
    }

    const ai = getAI();
    const langName = language === 'zh-TW' ? 'Traditional Chinese (Taiwan)' : 'English';

    FocalPointLogger.info("Analysis_Start", { personas: personas.map(p => p.id), fileUri });

    const results = await Promise.all(
      personas.map(persona => 
        analyzeWithPersona(ai, persona, {
          title,
          synopsis,
          srtContent,
          questions,
          langName,
          fileUri,
          fileMimeType
        })
      )
    );

    FocalPointLogger.info("Analysis_Complete", { 
      total: results.length, 
      successful: results.filter(r => r.status === 'success').length 
    });

    res.json({ results });

  } catch (error: any) {
    // SECURITY: Log full error internally, return generic message to client
    FocalPointLogger.error("API_Call", error);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

process.on('uncaughtException', (error) => {
  console.error('[FocalPoint][FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FocalPoint][FATAL] Unhandled Rejection:', reason);
});

process.on('exit', (code) => {
  console.error(`[FocalPoint][EXIT] Process exiting with code: ${code}`);
});

console.log('[FocalPoint] Starting server...');
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FocalPoint] Backend server running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('[FocalPoint][FATAL] Server error:', err);
});

const gracefulShutdown = (signal: string) => {
  console.log(`[FocalPoint] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('[FocalPoint] Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[FocalPoint] Forcing shutdown after timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

console.log('[FocalPoint] Server setup complete, waiting for listen callback...');
