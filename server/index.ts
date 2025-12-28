console.log('[FocalPoint] Server module loading...');

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";
import { getPersonaById, getAllPersonas, PersonaConfig } from './personas.js';

console.log('[FocalPoint] All imports successful');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? 5000 : 3001;

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
    // In production, check against allowed origins and Replit domains
    if (isProduction) {
      if (origin.endsWith('.repl.co') || origin.endsWith('.replit.dev') || origin.endsWith('.replit.app')) {
        return callback(null, true);
      }
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

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_VIDEO_SIZE_BYTES }
});

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

const handleMulterError = (err: any, req: any, res: any, next: any) => {
  if (err) {
    // SECURITY: Log full error internally, return generic message to client
    FocalPointLogger.error("Multer", err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB.` });
    }
    return res.status(500).json({ error: "Upload error. Please try again." });
  }
  next();
};

app.post('/api/upload', uploadLimiter, upload.single('video'), handleMulterError, async (req, res) => {
  logMem('upload_start');
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No video file provided." });
    }

    // SECURITY: Validate MIME type is video
    if (!ALLOWED_VIDEO_MIMES.includes(file.mimetype) && !file.mimetype.startsWith('video/')) {
      fs.unlink(file.path, () => {});
      FocalPointLogger.warn("Upload_Rejected", `Invalid MIME type: ${file.mimetype}`);
      return res.status(400).json({ error: "Invalid file type. Only video files are accepted." });
    }
    
    logMem('after_multer');
    console.log('[FocalPoint] Received file from client, starting resumable upload to Gemini...');

    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    FocalPointLogger.info("Upload_Start", { name: file.originalname, size: `${fileSizeMB} MB` });

    const uploadedFile = await uploadFileWithResumable(
      file.path,
      file.mimetype,
      file.originalname || 'video'
    );

    FocalPointLogger.info("Upload_Complete", { name: uploadedFile.name, uri: uploadedFile.uri });

    const ai = getAI();
    let fileInfo = await ai.files.get({ name: uploadedFile.name });

    if (fileInfo.state === "FAILED") {
      fs.unlink(file.path, () => {});
      // SECURITY: Log full error internally, return generic message to client
      const errorMsg = (fileInfo as any).error?.message ?? "unknown error";
      FocalPointLogger.error("Processing_Failed", errorMsg);
      return res.status(500).json({ 
        error: "Video processing failed. Please try a different video format." 
      });
    }

    const startTime = Date.now();
    let attempt = 0;
    let delayMs = INITIAL_DELAY_MS;

    while (fileInfo.state === "PROCESSING") {
      const elapsedMs = Date.now() - startTime;

      if (elapsedMs > MAX_WAIT_MS) {
        fs.unlink(file.path, () => {});
        // SECURITY: Log timeout internally, return generic message to client
        FocalPointLogger.warn("Processing_Timeout", `Timed out after ${Math.round(elapsedMs / 1000)}s`);
        return res.status(500).json({ 
          error: "Video processing timed out. Please try a shorter or smaller video." 
        });
      }

      FocalPointLogger.info(
        "Processing",
        `Waiting for video processing… attempt=${attempt + 1}, elapsed=${Math.round(elapsedMs / 1000)}s, nextDelay=${Math.round(delayMs)}ms`
      );

      await sleepWithJitter(delayMs);

      fileInfo = await ai.files.get({ name: uploadedFile.name });

      if (fileInfo.state === "FAILED") {
        fs.unlink(file.path, () => {});
        // SECURITY: Log full error internally, return generic message to client
        const errorMsg = (fileInfo as any).error?.message ?? "unknown error";
        FocalPointLogger.error("Processing_Failed", errorMsg);
        return res.status(500).json({ 
          error: "Video processing failed. Please try a different video format." 
        });
      }

      delayMs = Math.min(delayMs * BACKOFF_FACTOR, MAX_DELAY_MS);
      attempt++;
    }

    fs.unlink(file.path, () => {});

    FocalPointLogger.info("Processing_Complete", { state: fileInfo.state });
    logMem('upload_complete');

    res.json({
      fileUri: fileInfo.uri,
      fileMimeType: file.mimetype,
      fileName: uploadedFile.name
    });

  } catch (error: any) {
    logMem('upload_error');
    FocalPointLogger.error("Upload", error);
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    // SECURITY: Log full error internally, return generic message to client
    res.status(500).json({ error: "Upload failed. Please try again." });
  }
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
