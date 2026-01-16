import { db } from '../db';
import { uploads } from '../../shared/schema';
import { eq } from 'drizzle-orm';

export interface ProgressPayload {
  stage: string;
  pct: number;
  message: string;
}

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const PROGRESS_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 1000,
};

const MILESTONE_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 8,
  baseDelayMs: 250,
  maxDelayMs: 5000,
};

const TRANSIENT_ERROR_CODES = ['08P01', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
const TRANSIENT_ERROR_PATTERNS = ['timeout', 'connection terminated', 'Authentication timed out', 'socket hang up'];

function isTransientError(error: unknown): boolean {
  if (!error) return false;
  
  const errorObj = error as { code?: string; message?: string; cause?: { message?: string } };
  
  if (errorObj.code && TRANSIENT_ERROR_CODES.includes(errorObj.code)) {
    return true;
  }
  
  const message = errorObj.message || errorObj.cause?.message || '';
  return TRANSIENT_ERROR_PATTERNS.some(pattern => 
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = Math.random() * 0.3 * cappedDelay;
  return cappedDelay + jitter;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  context: { uploadId: string; stage: string; operationType: string }
): Promise<{ success: boolean; result?: T; error?: unknown }> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 0) {
        console.log(`[ProgressManager] ${context.operationType} succeeded after ${attempt + 1} attempts`, {
          uploadId: context.uploadId,
          stage: context.stage,
        });
      }
      return { success: true, result };
    } catch (error) {
      lastError = error;
      
      if (!isTransientError(error)) {
        console.error(`[ProgressManager] ${context.operationType} failed with non-transient error`, {
          uploadId: context.uploadId,
          stage: context.stage,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error };
      }
      
      if (attempt < config.maxAttempts - 1) {
        const delay = calculateDelay(attempt, config);
        console.warn(`[ProgressManager] ${context.operationType} transient failure, retrying in ${Math.round(delay)}ms`, {
          uploadId: context.uploadId,
          stage: context.stage,
          attempt: attempt + 1,
          maxAttempts: config.maxAttempts,
          errorCode: (error as { code?: string }).code,
        });
        await sleep(delay);
      }
    }
  }
  
  console.error(`[ProgressManager] ${context.operationType} failed after ${config.maxAttempts} attempts`, {
    uploadId: context.uploadId,
    stage: context.stage,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  
  return { success: false, error: lastError };
}

export class ProgressFlushManager {
  private uploadId: string;
  private lastFlushAt: number = 0;
  private inFlight: Promise<void> | null = null;
  private pendingProgress: ProgressPayload | null = null;
  private lastFlushedPct: number = 0;
  private maxSeenPct: number = 0;
  private flushIntervalMs: number;
  private minPctChange: number;
  
  constructor(
    uploadId: string,
    options: { flushIntervalMs?: number; minPctChange?: number } = {}
  ) {
    this.uploadId = uploadId;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.minPctChange = options.minPctChange ?? 5;
  }
  
  updateProgress(progress: ProgressPayload): void {
    if (progress.pct < this.maxSeenPct) {
      return;
    }
    this.maxSeenPct = progress.pct;
    
    this.pendingProgress = progress;
    
    if (this.inFlight) {
      return;
    }
    
    const now = Date.now();
    const timeSinceLastFlush = now - this.lastFlushAt;
    const pctChange = progress.pct - this.lastFlushedPct;
    
    const shouldFlush = 
      timeSinceLastFlush >= this.flushIntervalMs || 
      pctChange >= this.minPctChange ||
      this.lastFlushAt === 0;
    
    if (shouldFlush) {
      this.startFlush();
    }
  }
  
  private startFlush(): void {
    if (this.inFlight || !this.pendingProgress) {
      return;
    }
    
    const progressSnapshot = { ...this.pendingProgress };
    
    this.inFlight = this.doFlush(progressSnapshot)
      .finally(() => {
        this.inFlight = null;
        
        if (this.pendingProgress && 
            (this.pendingProgress.pct !== progressSnapshot.pct || 
             this.pendingProgress.stage !== progressSnapshot.stage)) {
          const now = Date.now();
          if (now - this.lastFlushAt >= this.flushIntervalMs) {
            this.startFlush();
          }
        }
      });
  }
  
  private async doFlush(progress: ProgressPayload): Promise<void> {
    const result = await retryWithBackoff(
      async () => {
        await db
          .update(uploads)
          .set({
            progress: { stage: progress.stage, pct: progress.pct, message: progress.message },
            updatedAt: new Date(),
          })
          .where(eq(uploads.uploadId, this.uploadId));
      },
      PROGRESS_RETRY_CONFIG,
      { uploadId: this.uploadId, stage: progress.stage, operationType: 'progress update' }
    );
    
    if (result.success) {
      this.lastFlushAt = Date.now();
      this.lastFlushedPct = progress.pct;
    }
  }
  
  async flushFinal(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
    }
    if (this.pendingProgress) {
      await this.doFlush(this.pendingProgress);
    }
  }
}

export type MilestoneType = 
  | 'ANALYZING'
  | 'COMPRESS_STARTED' 
  | 'COMPRESS_DONE' 
  | 'SKIPPED_COMPRESSION'
  | 'UPLOADING_PROXY'
  | 'GEMINI_UPLOAD_STARTED' 
  | 'GEMINI_UPLOAD_DONE' 
  | 'PROCESSING_ACTIVE'
  | 'READY'
  | 'JOB_FAILED';

interface MilestoneData {
  stage: string;
  pct: number;
  message: string;
  status?: string;
  extraFields?: Record<string, unknown>;
}

const MILESTONE_DEFINITIONS: Record<MilestoneType, MilestoneData> = {
  ANALYZING: { stage: 'analyzing', pct: 5, message: 'Analyzing video...' },
  COMPRESS_STARTED: { stage: 'compressing', pct: 5, message: 'Creating analysis proxy (720p, 2fps)...' },
  COMPRESS_DONE: { stage: 'compressed', pct: 55, message: 'Compression complete' },
  SKIPPED_COMPRESSION: { stage: 'skipped_compression', pct: 55, message: 'Video already optimized, proceeding...' },
  UPLOADING_PROXY: { stage: 'uploading_proxy', pct: 55, message: 'Uploading proxy to storage...' },
  GEMINI_UPLOAD_STARTED: { stage: 'transferring', pct: 65, message: 'Sending to AI reviewer...' },
  GEMINI_UPLOAD_DONE: { stage: 'transferred', pct: 85, message: 'Transfer complete, awaiting processing...' },
  PROCESSING_ACTIVE: { stage: 'processing', pct: 90, message: 'AI reviewer is getting ready...' },
  READY: { stage: 'ready', pct: 100, message: 'Ready for analysis!' },
  JOB_FAILED: { stage: 'failed', pct: 0, message: 'Upload processing failed' },
};

export async function writeMilestone(
  uploadId: string,
  milestone: MilestoneType,
  overrides?: Partial<MilestoneData>
): Promise<{ success: boolean; error?: unknown }> {
  const definition = MILESTONE_DEFINITIONS[milestone];
  const data = { ...definition, ...overrides };
  
  console.log(`[ProgressManager] Writing milestone`, {
    uploadId,
    milestone,
    stage: data.stage,
    pct: data.pct,
  });
  
  const updateFields: Record<string, unknown> = {
    progress: { stage: data.stage, pct: data.pct, message: data.message },
    updatedAt: new Date(),
  };
  
  if (data.status) {
    updateFields.status = data.status;
  }
  
  if (data.extraFields) {
    Object.assign(updateFields, data.extraFields);
  }
  
  const result = await retryWithBackoff(
    async () => {
      await db
        .update(uploads)
        .set(updateFields)
        .where(eq(uploads.uploadId, uploadId));
    },
    MILESTONE_RETRY_CONFIG,
    { uploadId, stage: data.stage, operationType: `milestone ${milestone}` }
  );
  
  if (!result.success) {
    console.error(`[ProgressManager] CRITICAL: Milestone ${milestone} failed to persist`, {
      uploadId,
      error: result.error instanceof Error ? result.error.message : String(result.error),
    });
  }
  
  return result;
}
