import { GoogleGenAI } from "@google/genai";
import { db } from '../db.js';
import { uploads } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { FocalPointLogger } from '../utils/logger.js';

const CACHE_TTL_SECONDS = 3600;
const CACHE_SAFETY_MARGIN_MS = 120_000;

const API_VERSIONS_TO_TRY = ['v1alpha', 'v1beta'] as const;

function isCacheTransientError(error: any): boolean {
  const msg = (error?.message || '').toLowerCase();
  const status = error?.status || error?.httpStatus || error?.statusCode;
  const code = error?.cause?.code;
  return (
    status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
    code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' ||
    msg.includes('fetch failed') || msg.includes('503') || msg.includes('overloaded') ||
    msg.includes('unavailable') || msg.includes('internal')
  );
}

async function createCacheViaREST(
  fileUri: string,
  fileMimeType: string,
  model: string,
  apiVersion: string
): Promise<{ name: string; usageMetadata?: any } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required");

  const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/cachedContents?key=${apiKey}`;

  const body: any = {
    model: `models/${model}`,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              mimeType: fileMimeType || "video/mp4",
              fileUri: fileUri
            }
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: "You are a professional film analyst. Analyze the video content thoroughly and respond in JSON format as instructed."
        }
      ]
    },
    ttl: `${CACHE_TTL_SECONDS}s`,
    mediaResolution: "MEDIA_RESOLUTION_LOW"
  };

  FocalPointLogger.info("Cache_REST_Request", {
    endpoint: endpoint.replace(apiKey, '***'),
    apiVersion,
    model: `models/${model}`,
    fileUri: fileUri.substring(0, 80),
    hasMediaResolution: true,
    bodyKeys: Object.keys(body)
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const responseBody = await response.json();

  if (!response.ok) {
    FocalPointLogger.error("Cache_REST_Response_Error", {
      apiVersion,
      status: response.status,
      error: JSON.stringify(responseBody).substring(0, 500)
    });
    throw new Error(JSON.stringify(responseBody));
  }

  FocalPointLogger.info("Cache_REST_Response_OK", {
    apiVersion,
    cacheName: responseBody.name,
    totalTokenCount: responseBody.usageMetadata?.totalTokenCount,
    model: responseBody.model,
    responseKeys: Object.keys(responseBody)
  });

  return {
    name: responseBody.name,
    usageMetadata: responseBody.usageMetadata
  };
}

export async function ensureVideoCache(
  _ai: GoogleGenAI,
  uploadId: string,
  fileUri: string,
  fileMimeType: string,
  model: string = 'gemini-2.5-flash'
): Promise<string | null> {
  const [upload] = await db.select()
    .from(uploads)
    .where(eq(uploads.uploadId, uploadId))
    .limit(1);

  if (upload?.cacheName && upload?.cacheExpiresAt) {
    const now = new Date();
    const expiresAt = new Date(upload.cacheExpiresAt);
    if (expiresAt.getTime() - now.getTime() > CACHE_SAFETY_MARGIN_MS) {
      FocalPointLogger.info("Cache_Hit", { uploadId, cacheName: upload.cacheName });
      return upload.cacheName;
    }
    FocalPointLogger.info("Cache_Expired", { uploadId, cacheName: upload.cacheName });
  }

  const MAX_CACHE_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_CACHE_ATTEMPTS; attempt++) {
    try {
      FocalPointLogger.info("Cache_Create_Start", { fileUri: fileUri.substring(0, 80), model, attempt, method: 'REST' });

      let lastError: any = null;
      let cache: { name: string; usageMetadata?: any } | null = null;

      for (const apiVersion of API_VERSIONS_TO_TRY) {
        try {
          cache = await createCacheViaREST(fileUri, fileMimeType, model, apiVersion);
          if (cache?.name) {
            FocalPointLogger.info("Cache_Create_Success", {
              cacheName: cache.name,
              model,
              apiVersion,
              totalTokenCount: cache.usageMetadata?.totalTokenCount,
              ttl: CACHE_TTL_SECONDS,
              attempt
            });
            break;
          }
        } catch (err: any) {
          lastError = err;
          FocalPointLogger.warn("Cache_REST_Version_Failed", `${apiVersion}: ${err.message?.substring(0, 300)} (attempt ${attempt})`);
        }
      }

      if (!cache?.name) {
        throw lastError || new Error('All API versions failed for cache creation');
      }

      const cacheName = cache.name;
      const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);

      await db.update(uploads)
        .set({
          cacheName,
          cacheModel: model,
          cacheStatus: 'ACTIVE',
          cacheExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(uploads.uploadId, uploadId));

      return cacheName;
    } catch (error: any) {
      const isLastAttempt = attempt === MAX_CACHE_ATTEMPTS;
      const isTransient = isCacheTransientError(error);

      if (isLastAttempt || !isTransient) {
        FocalPointLogger.error("Cache_Create_Failed", `${error.message} (attempt ${attempt}/${MAX_CACHE_ATTEMPTS}, fileUri: ${fileUri.substring(0, 80)})`);

        await db.update(uploads)
          .set({
            cacheStatus: 'FAILED',
            updatedAt: new Date(),
          })
          .where(eq(uploads.uploadId, uploadId)).catch(() => {});

        return null;
      }

      const BACKOFF_DELAYS = [2000, 5000, 10000];
      const base = BACKOFF_DELAYS[attempt - 1] || 10000;
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      const delay = Math.round(base + jitter);

      FocalPointLogger.warn("Cache_Create_Retry", `Attempt ${attempt}/${MAX_CACHE_ATTEMPTS} failed: ${error.message}. Retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return null;
}

export async function deleteVideoCache(ai: GoogleGenAI, cacheName: string, uploadId?: string): Promise<void> {
  try {
    await ai.caches.delete({ name: cacheName });
    FocalPointLogger.info("Cache_Deleted", { cacheName });
  } catch (error: any) {
    FocalPointLogger.warn("Cache_Delete_Failed", `${cacheName}: ${error.message}`);
  }

  if (uploadId) {
    await db.update(uploads)
      .set({
        cacheName: null,
        cacheModel: null,
        cacheStatus: 'DELETED',
        cacheExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId)).catch(() => {});
  }
}

export async function findUploadIdByFileUri(fileUri: string): Promise<string | undefined> {
  const [upload] = await db.select({ uploadId: uploads.uploadId })
    .from(uploads)
    .where(eq(uploads.geminiFileUri, fileUri))
    .limit(1);
  return upload?.uploadId;
}
