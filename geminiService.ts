import { Persona, AgentReport, Project } from "./types";

const FocalPointLogger = {
  info: (stage: string, data: any) => console.debug(`[FocalPoint][INFO][${stage}]`, data),
  warn: (stage: string, msg: string) => console.warn(`[FocalPoint][WARN][${stage}]`, msg),
  error: (stage: string, err: any) => console.error(`[FocalPoint][ERROR][${stage}]`, err)
};

const MAX_VIDEO_SIZE_MB = 2000;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

export interface UploadResult {
  fileUri: string;
  fileMimeType: string;
  fileName: string;
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

  onProgress?.(10);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  onProgress?.(50);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `Upload failed: ${response.status}`);
  }

  const result = await response.json();
  FocalPointLogger.info("Upload_Complete", result);
  
  onProgress?.(100);
  
  return result;
};

export const generateAgentReport = async (
  persona: Persona,
  project: Project,
  uploadResult: UploadResult
): Promise<AgentReport> => {
  if (!project.title || project.title.trim().length === 0) {
    throw new Error("DATA_ERR_01: Invalid Project Metadata.");
  }

  if (!uploadResult?.fileUri) {
    throw new Error("DATA_ERR_02: Video must be uploaded first.");
  }

  FocalPointLogger.info("API_Call", { persona: persona.name, fileUri: uploadResult.fileUri });

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: project.title,
        synopsis: project.synopsis,
        srtContent: project.srtContent,
        questions: project.questions,
        language: project.language,
        fileUri: uploadResult.fileUri,
        fileMimeType: uploadResult.fileMimeType
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const report = await response.json();
    FocalPointLogger.info("API_Success", "Report synthesized and parsed.");
    return report;
  } catch (error: any) {
    FocalPointLogger.error("API_Call", error);
    throw new Error(`Screening failed: ${error.message}`);
  }
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
