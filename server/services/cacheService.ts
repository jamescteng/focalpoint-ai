import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import { db } from '../db.js';
import { uploads } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { FocalPointLogger } from '../utils/logger.js';

const CACHE_TTL_SECONDS = 3600;
const CACHE_SAFETY_MARGIN_MS = 120_000;

export async function ensureVideoCache(
  ai: GoogleGenAI,
  uploadId: string,
  fileUri: string,
  fileMimeType: string,
  model: string = 'gemini-3-flash-preview'
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

  try {
    FocalPointLogger.info("Cache_Create_Start", { fileUri: fileUri.substring(0, 80), model });

    const videoPart = createPartFromUri(fileUri, fileMimeType || 'video/mp4');

    const cache = await ai.caches.create({
      model,
      config: {
        contents: [createUserContent(videoPart)],
        systemInstruction: `You are a professional film analyst. Analyze the video content thoroughly and respond in JSON format as instructed.`,
        ttl: `${CACHE_TTL_SECONDS}s`,
      }
    });

    const cacheName = cache.name!;
    const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);

    FocalPointLogger.info("Cache_Create_Success", { cacheName, model, ttl: CACHE_TTL_SECONDS });

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
    FocalPointLogger.error("Cache_Create_Failed", `${error.message} (fileUri: ${fileUri.substring(0, 80)})`);

    await db.update(uploads)
      .set({
        cacheStatus: 'FAILED',
        updatedAt: new Date(),
      })
      .where(eq(uploads.uploadId, uploadId)).catch(() => {});

    return null;
  }
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
