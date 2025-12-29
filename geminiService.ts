import { AgentReport, Project } from "./types";

const FocalPointLogger = {
  info: (stage: string, data: any) => console.debug(`[FocalPoint][INFO][${stage}]`, data),
  warn: (stage: string, msg: string) => console.warn(`[FocalPoint][WARN][${stage}]`, msg),
  error: (stage: string, err: any) => console.error(`[FocalPoint][ERROR][${stage}]`, err)
};

const MAX_VIDEO_SIZE_MB = 2000;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_TIME_MS = 15 * 60 * 1000;

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
  onProgress?: (progress: number) => void
): Promise<UploadResult> {
  const startTime = Date.now();
  
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_POLL_TIME_MS) {
      throw new Error('Upload timed out. Please try again with a smaller video.');
    }
    
    const response = await fetch(`/api/upload/status/${jobId}`);
    
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

export const uploadVideo = async (
  file: File,
  onProgress?: (progress: number) => void
): Promise<UploadResult> => {
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  FocalPointLogger.info("Upload_Start", { name: file.name, size: `${fileSizeMB} MB` });

  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(`Video file is too large (${fileSizeMB}MB). Maximum size is ${MAX_VIDEO_SIZE_MB}MB.`);
  }

  const formData = new FormData();
  formData.append('video', file);

  onProgress?.(1);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorData = await safeJsonParse<{ error?: string }>(response);
    throw new Error(errorData.error || `Upload failed: ${response.status}`);
  }

  const startResult = await safeJsonParse<{ jobId: string; status: string }>(response);
  FocalPointLogger.info("Upload_JobCreated", { jobId: startResult.jobId });
  
  onProgress?.(3);

  const result = await pollUploadStatus(startResult.jobId, onProgress);
  FocalPointLogger.info("Upload_Complete", result);
  
  return result;
};

export const analyzeWithPersona = async (
  project: Project,
  uploadResult: UploadResult,
  personaId: string
): Promise<AgentReport> => {
  if (!project.title || project.title.trim().length === 0) {
    throw new Error("DATA_ERR_01: Invalid Project Metadata.");
  }

  if (!uploadResult?.fileUri) {
    throw new Error("DATA_ERR_02: Video must be uploaded first.");
  }

  FocalPointLogger.info("API_Call", { persona: personaId, fileUri: uploadResult.fileUri });

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: project.title,
        synopsis: project.synopsis,
        srtContent: project.srtContent || '',
        questions: project.questions,
        language: project.language,
        fileUri: uploadResult.fileUri,
        fileMimeType: uploadResult.fileMimeType,
        personaIds: [personaId]
      })
    });

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
    FocalPointLogger.error("API_Call", error);
    throw new Error(`Screening failed: ${error.message}`);
  }
};

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
