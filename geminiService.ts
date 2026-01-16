import { AgentReport, Project } from "./types";

const FocalPointLogger = {
  info: (stage: string, data: any) => console.debug(`[FocalPoint][INFO][${stage}]`, data),
  warn: (stage: string, msg: string) => console.warn(`[FocalPoint][WARN][${stage}]`, msg),
  error: (stage: string, err: any) => console.error(`[FocalPoint][ERROR][${stage}]`, err)
};

const MAX_VIDEO_SIZE_MB = 2000;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_TIME_MS = 40 * 60 * 1000;

const MAX_UPLOAD_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function getUploadBaseUrl(): string {
  const hostname = window.location.hostname;
  const port = window.location.port;
  
  if (hostname === 'localhost' && port === '5000') {
    return 'http://localhost:3001';
  }
  
  return '';
}

function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('network') || msg.includes('abort') || msg.includes('failed to fetch');
  }
  return false;
}

export interface UploadResult {
  fileUri: string;
  fileMimeType: string;
  fileName: string;
}

interface UploadJobResponse {
  jobId: string;
  status: 'RECEIVED' | 'SPOOLING' | 'UPLOADING' | 'PROCESSING' | 'ACTIVE' | 'ERROR';
  progress: number;
  fileUri: string | null;
  fileMimeType: string | null;
  fileName: string | null;
  error: string | null;
}

interface DirectUploadInitResponse {
  uploadId: string;
  storageKey: string;
  putUrl: string;
  headers: { 'Content-Type': string };
  expiresInSec: number;
}

interface DirectUploadStatusResponse {
  status: 'UPLOADING' | 'STORED' | 'COMPRESSING' | 'COMPRESSED' | 'TRANSFERRING_TO_GEMINI' | 'ACTIVE' | 'FAILED';
  progress: { stage: string; pct: number; message?: string };
  geminiFileUri: string | null;
  lastError: string | null;
  mimeType?: string;
  filename?: string;
}

export interface PersonaResult {
  personaId: string;
  status: 'success' | 'error';
  report?: {
    executive_summary: string;
    highlights: any[];
    concerns: any[];
    answers: any[];
  };
  error?: string;
  validationWarnings?: string[];
}

export interface AnalyzeResponse {
  results: PersonaResult[];
}

async function safeJsonParse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text || text.trim() === '') {
    throw new Error('Server returned empty response');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid response from server: ${text.substring(0, 100)}`);
  }
}

async function pollUploadStatus(
  jobId: string,
  onProgress?: (progress: number) => void,
  onStatusMessage?: (message: string) => void
): Promise<UploadResult> {
  const startTime = Date.now();
  
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_POLL_TIME_MS) {
      throw new Error('Upload timed out. Please try again with a smaller video.');
    }
    
    const statusUrl = `${getUploadBaseUrl()}/api/upload/status/${jobId}`;
    const response = await fetch(statusUrl);
    
    if (!response.ok) {
      const errorData = await safeJsonParse<{ error?: string }>(response);
      throw new Error(errorData.error || `Status check failed: ${response.status}`);
    }
    
    const status = await safeJsonParse<UploadJobResponse>(response);
    
    FocalPointLogger.info("Upload_Status", { jobId, status: status.status, progress: status.progress });
    
    onProgress?.(status.progress);
    
    if (status.status === 'ACTIVE' && status.fileUri && status.fileMimeType && status.fileName) {
      return {
        fileUri: status.fileUri,
        fileMimeType: status.fileMimeType,
        fileName: status.fileName
      };
    }
    
    if (status.status === 'ERROR') {
      throw new Error(status.error || 'Upload failed');
    }
    
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function uploadToStorageWithProgress(
  file: File,
  putUrl: string,
  contentType: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const rawPct = Math.floor((event.loaded / event.total) * 100);
        const scaledPct = Math.floor(rawPct * 0.4);
        onProgress(scaledPct);
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    
    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload to storage'));
    });
    
    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was aborted'));
    });
    
    xhr.open('PUT', putUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(file);
  });
}

async function pollDirectUploadStatus(
  uploadId: string,
  onProgress?: (progress: number) => void,
  onStatusMessage?: (message: string) => void
): Promise<UploadResult> {
  const startTime = Date.now();
  const baseUrl = getUploadBaseUrl();
  
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_POLL_TIME_MS) {
      throw new Error('Video processing timed out. Please try again.');
    }
    
    const statusUrl = `${baseUrl}/api/uploads/status/${uploadId}`;
    const response = await fetch(statusUrl);
    
    if (!response.ok) {
      const errorData = await safeJsonParse<{ error?: string }>(response);
      throw new Error(errorData.error || `Status check failed: ${response.status}`);
    }
    
    const status = await safeJsonParse<DirectUploadStatusResponse>(response);
    
    FocalPointLogger.info("DirectUpload_Status", { uploadId, status: status.status, progress: status.progress });
    
    if (status.progress) {
      const stage = status.progress.stage;
      const pct = status.progress.pct;
      const serverMessage = status.progress.message;
      
      onProgress?.(pct);
      
      if (serverMessage) {
        onStatusMessage?.(serverMessage);
      } else if (stage === 'uploading') {
        onStatusMessage?.('Uploading video...');
      } else if (stage === 'stored') {
        onStatusMessage?.('Upload complete, preparing video...');
      } else if (stage === 'compressing') {
        onStatusMessage?.('Creating optimized analysis copy...');
      } else if (stage === 'compressed') {
        onStatusMessage?.('Video optimized, preparing for review...');
      } else if (stage === 'transferring') {
        onStatusMessage?.('Sending to AI reviewer...');
      } else if (stage === 'processing') {
        onStatusMessage?.('AI is preparing to watch your video...');
      } else if (stage === 'ready') {
        onStatusMessage?.('Ready for analysis!');
      }
    }
    
    if (status.status === 'ACTIVE' && status.geminiFileUri) {
      return {
        fileUri: status.geminiFileUri,
        fileMimeType: status.mimeType || 'video/mp4',
        fileName: status.filename || uploadId
      };
    }
    
    if (status.status === 'FAILED') {
      throw new Error(status.lastError || 'Upload processing failed');
    }
    
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export const uploadVideo = async (
  file: File,
  onProgress?: (progress: number) => void,
  attemptId?: string,
  onStatusMessage?: (message: string) => void
): Promise<UploadResult> => {
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  const uploadAttemptId = attemptId || `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  
  FocalPointLogger.info("Upload_Start", { 
    name: file.name, 
    size: `${fileSizeMB} MB`,
    attemptId: uploadAttemptId
  });

  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(`Video file is too large (${fileSizeMB}MB). Maximum size is ${MAX_VIDEO_SIZE_MB}MB.`);
  }

  const baseUrl = getUploadBaseUrl();
  
  try {
    onProgress?.(1);
    onStatusMessage?.('Initializing upload...');
    
    const initResponse = await fetch(`${baseUrl}/api/uploads/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'video/mp4',
        sizeBytes: file.size,
        attemptId: uploadAttemptId,
      }),
    });
    
    if (!initResponse.ok) {
      const errorData = await safeJsonParse<{ error?: string }>(initResponse);
      throw new Error(errorData.error || `Failed to initialize upload: ${initResponse.status}`);
    }
    
    const initResult = await safeJsonParse<DirectUploadInitResponse>(initResponse);
    FocalPointLogger.info("DirectUpload_Init", { uploadId: initResult.uploadId });
    
    onProgress?.(2);
    onStatusMessage?.('Uploading to storage...');
    
    await uploadToStorageWithProgress(
      file,
      initResult.putUrl,
      initResult.headers['Content-Type'],
      onProgress
    );
    
    FocalPointLogger.info("DirectUpload_StorageComplete", { uploadId: initResult.uploadId });
    onProgress?.(40);
    onStatusMessage?.('Verifying upload...');
    
    const completeResponse = await fetch(`${baseUrl}/api/uploads/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: initResult.uploadId }),
    });
    
    if (!completeResponse.ok) {
      const errorData = await safeJsonParse<{ error?: string }>(completeResponse);
      throw new Error(errorData.error || `Failed to complete upload: ${completeResponse.status}`);
    }
    
    FocalPointLogger.info("DirectUpload_Completed", { uploadId: initResult.uploadId });
    onStatusMessage?.('Preparing video for analysis...');
    
    const result = await pollDirectUploadStatus(initResult.uploadId, onProgress, onStatusMessage);
    FocalPointLogger.info("DirectUpload_Ready", result);
    
    return {
      ...result,
      fileName: file.name,
    };
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    FocalPointLogger.error("DirectUpload_Error", err.message);
    throw err;
  }
};

const ANALYSIS_TIMEOUT_MS = 900000;
const MAX_RETRIES = 1;

const isNetworkError = (error: any): boolean => {
  const message = error?.message?.toLowerCase() || '';
  return message.includes('load failed') || 
         message.includes('failed to fetch') || 
         message.includes('network') ||
         message.includes('aborted') ||
         error?.name === 'AbortError' ||
         error?.name === 'TypeError';
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const analyzeWithPersona = async (
  project: Project,
  uploadResult: UploadResult | null,
  personaId: string
): Promise<AgentReport> => {
  if (!project.title || project.title.trim().length === 0) {
    throw new Error("DATA_ERR_01: Invalid Project Metadata.");
  }

  const isYoutubeSession = !!project.youtubeUrl;
  
  if (!isYoutubeSession && !uploadResult?.fileUri) {
    throw new Error("DATA_ERR_02: Video must be uploaded first.");
  }

  FocalPointLogger.info("API_Call", { 
    persona: personaId, 
    fileUri: uploadResult?.fileUri,
    youtubeUrl: isYoutubeSession ? '[YouTube]' : undefined
  });

  const requestBody = JSON.stringify({
    title: project.title,
    synopsis: project.synopsis,
    srtContent: project.srtContent || '',
    questions: project.questions,
    language: project.language,
    fileUri: uploadResult?.fileUri,
    fileMimeType: uploadResult?.fileMimeType,
    youtubeUrl: project.youtubeUrl,
    personaIds: [personaId]
  });

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        FocalPointLogger.info("API_Retry", { attempt, persona: personaId });
      }

      const response = await fetchWithTimeout('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody
      }, ANALYSIS_TIMEOUT_MS);

      if (!response.ok) {
        const errorData = await safeJsonParse<{ error?: string }>(response);
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await safeJsonParse<AnalyzeResponse>(response);
      FocalPointLogger.info("API_Success", `Received ${data.results.length} persona report(s)`);
      
      const result = data.results[0];
      if (!result || result.status !== 'success' || !result.report) {
        throw new Error(result?.error || 'Analysis failed');
      }

      return {
        personaId: result.personaId,
        executive_summary: result.report.executive_summary,
        highlights: result.report.highlights,
        concerns: result.report.concerns,
        answers: result.report.answers,
        validationWarnings: result.validationWarnings
      };
    } catch (error: any) {
      lastError = error;
      FocalPointLogger.error("API_Call", { attempt, error: error.message });
      
      if (error.name === 'AbortError') {
        throw new Error('Screening failed: Request timed out. Please try again.');
      }
      
      if (!isNetworkError(error) || attempt >= MAX_RETRIES) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const errorMessage = lastError?.message || 'Unknown error';
  if (isNetworkError(lastError)) {
    throw new Error('Screening failed: Network connection lost. Please check your connection and try again.');
  }
  throw new Error(`Screening failed: ${errorMessage}`);
};

export interface PersonaAlias {
  personaId: string;
  name: string;
  role: string;
}

export interface DbSession {
  id: number;
  title: string;
  synopsis: string;
  questions: string[];
  language: string;
  fileUri: string | null;
  fileMimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileLastModified: number | null;
  youtubeUrl: string | null;
  youtubeEmbeddable: boolean | null;
  personaAliases: PersonaAlias[];
  createdAt: string;
  updatedAt: string;
}

export interface DbReport {
  id: number;
  sessionId: number;
  personaId: string;
  executiveSummary: string;
  highlights: any[];
  concerns: any[];
  answers: any[];
  validationWarnings: string[];
  createdAt: string;
}

export const createSession = async (data: {
  title: string;
  synopsis: string;
  questions: string[];
  language: string;
  fileUri?: string;
  fileMimeType?: string;
  fileName?: string;
  youtubeUrl?: string;
  youtubeEmbeddable?: boolean;
}): Promise<DbSession> => {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to create session');
  }
  
  return safeJsonParse<DbSession>(response);
};

export const getSessions = async (): Promise<DbSession[]> => {
  const response = await fetch('/api/sessions');
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to load sessions');
  }
  
  return safeJsonParse<DbSession[]>(response);
};

export const getSession = async (id: number): Promise<DbSession> => {
  const response = await fetch(`/api/sessions/${id}`);
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to load session');
  }
  
  return safeJsonParse<DbSession>(response);
};

export const updateSession = async (id: number, data: {
  fileUri?: string;
  fileMimeType?: string;
  fileName?: string;
  fileSize?: number;
  fileLastModified?: number;
}): Promise<DbSession> => {
  const response = await fetch(`/api/sessions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to update session');
  }
  
  return safeJsonParse<DbSession>(response);
};

export const deleteSession = async (id: number): Promise<void> => {
  const response = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to delete session');
  }
};

export const getReportsBySession = async (sessionId: number): Promise<DbReport[]> => {
  const response = await fetch(`/api/sessions/${sessionId}/reports`);
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to load reports');
  }
  
  return safeJsonParse<DbReport[]>(response);
};

export const saveReport = async (sessionId: number, report: AgentReport): Promise<DbReport> => {
  const response = await fetch(`/api/sessions/${sessionId}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personaId: report.personaId,
      executiveSummary: report.executive_summary,
      highlights: report.highlights,
      concerns: report.concerns,
      answers: report.answers,
      validationWarnings: report.validationWarnings || [],
    }),
  });
  
  if (!response.ok) {
    const error = await safeJsonParse<{ error?: string }>(response);
    throw new Error(error.error || 'Failed to save report');
  }
  
  return safeJsonParse<DbReport>(response);
};

export const fileToBytes = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    FocalPointLogger.info("Asset_Ingest", { name: file.name, size: `${fileSizeMB} MB` });
    
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      return reject(new Error(`Video file is too large (${fileSizeMB}MB). Please use a compressed video under ${MAX_VIDEO_SIZE_MB}MB.`));
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result) return reject(new Error("FILE_ERR: Stream read resulted in null output."));
      const base64 = result.split(',')[1];
      FocalPointLogger.info("Asset_Encoding", "Base64 stream generated successfully.");
      resolve(base64);
    };
    reader.onerror = () => {
      FocalPointLogger.error("Asset_Encoding", "Critical failure reading local file stream.");
      reject(new Error("FILE_ERR: Resource inaccessible or corrupted."));
    };
    reader.readAsDataURL(file);
  });
};
