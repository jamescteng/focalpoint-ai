console.log('[FocalPoint] Server module loading...');

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";

console.log('[FocalPoint] All imports successful');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? 5000 : 3001;

console.log('[FocalPoint] Configuring middleware...');
app.use(cors());

const jsonParser = express.json({ limit: '50mb' });
app.use((req, res, next) => {
  if (req.path === '/api/upload') {
    return next();
  }
  return jsonParser(req, res, next);
});

app.get('/api/health', (req, res) => {
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
}

const FocalPointLogger = {
  info: (stage: string, data: any) => console.log(`[FocalPoint][INFO][${stage}]`, data),
  warn: (stage: string, msg: string) => console.warn(`[FocalPoint][WARN][${stage}]`, msg),
  error: (stage: string, err: any) => console.error(`[FocalPoint][ERROR][${stage}]`, err)
};

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
    console.error('[FocalPoint][ERROR][Multer]', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB.` });
    }
    return res.status(500).json({ error: `Upload error: ${err.message}` });
  }
  next();
};

app.post('/api/upload', upload.single('video'), handleMulterError, async (req, res) => {
  logMem('upload_start');
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No video file provided." });
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
      const errorMsg = (fileInfo as any).error?.message ?? "unknown error";
      return res.status(500).json({ 
        error: `Video processing failed: ${errorMsg}. Please try a different video format.` 
      });
    }

    const startTime = Date.now();
    let attempt = 0;
    let delayMs = INITIAL_DELAY_MS;

    while (fileInfo.state === "PROCESSING") {
      const elapsedMs = Date.now() - startTime;

      if (elapsedMs > MAX_WAIT_MS) {
        fs.unlink(file.path, () => {});
        return res.status(500).json({ 
          error: `Video processing timed out after ${Math.round(elapsedMs / 1000)}s. Please try a shorter or smaller video.` 
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
        const errorMsg = (fileInfo as any).error?.message ?? "unknown error";
        return res.status(500).json({ 
          error: `Video processing failed: ${errorMsg}. Please try a different video format.` 
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
    res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { title, synopsis, srtContent, questions, language, fileUri, fileMimeType } = req.body as AnalyzeRequest;

    const ai = getAI();

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Invalid project metadata: title is required." });
    }

    if (!fileUri) {
      return res.status(400).json({ error: "Video file URI is required. Please upload a video first." });
    }

    const modelName = "gemini-2.5-flash";
    const langName = language === 'zh-TW' ? 'Traditional Chinese (Taiwan)' : 'English';

    const userPrompt = `
      INSTRUCTIONS: Perform a professional indie film focus group appraisal.
      FILM: "${title}"
      SYNOPSIS: ${synopsis}
      CONTEXTUAL DIALOGUE: ${srtContent.substring(0, 5000)}

      GOALS:
      1. Executive critical summary (~300-500 words).
      2. Exactly 5 HIGHLIGHTS and exactly 5 CONCERNS (see definitions below).
      3. Direct responses to user-defined research objectives:
      ${questions.map((q, i) => `Objective ${i + 1}: ${q}`).join('\n')}

      === HIGHLIGHTS vs CONCERNS DEFINITIONS ===
      
      HIGHLIGHT = moments that increase audience engagement, clarity, emotional impact, or commercial/festival appeal.
      For each highlight, explain WHY it works and categorize it (emotion, craft, clarity, or marketability).

      CONCERN = moments that reduce engagement or clarity, create confusion, feel slow, undermine credibility, or hurt marketability.
      Examples: pacing drag, unclear stakes, tonal mismatch, weak performance beat, audio/visual distraction, narrative logic gap.
      
      === CONCERN REQUIREMENTS ===
      - Each concern MUST include: issue description, impact explanation, and severity (1-5 where 3 = meaningful problem).
      - At least 3 concerns MUST have severity >= 3.
      - Categorize each concern: pacing, clarity, character, audio, visual, tone, or marketability.
      - Include a suggested fix for each concern.
      - Do NOT soften criticism. Write concerns as a professional acquisitions/notes memo.
      - Use timestamps and describe the specific moment as evidence.

      CONSTRAINTS:
      - Respond strictly in ${langName}.
      - Ensure output is structured as valid JSON.
      - Return EXACTLY 5 highlights and EXACTLY 5 concerns.
    `;

    const systemInstruction = `
      IDENTITY: You are a Senior Acquisitions Director at a major independent film distribution company.
      LENS: Acquisitions, pacing, and commercial viability.
      LANGUAGE: You MUST communicate your entire report in ${langName}.
      CRITICAL STANCE: You are known for your honest, no-nonsense assessments. You do not sugarcoat problems. When you identify a concern, you state it directly with its impact and severity. Your job is to help filmmakers improve their work, not to make them feel good.
    `;

    FocalPointLogger.info("API_Call", { model: modelName, fileUri });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          createPartFromUri(fileUri, fileMimeType || 'video/mp4'),
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            highlights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  timestamp: { type: Type.STRING },
                  seconds: { type: Type.NUMBER },
                  summary: { type: Type.STRING },
                  why_it_works: { type: Type.STRING },
                  category: { type: Type.STRING, enum: ["emotion", "craft", "clarity", "marketability"] }
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
                  category: { type: Type.STRING, enum: ["pacing", "clarity", "character", "audio", "visual", "tone", "marketability"] },
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
          required: ["summary", "highlights", "concerns", "answers"]
        }
      }
    });

    const report = safeParseReport(response.text || "{}");
    FocalPointLogger.info("API_Success", "Report synthesized and parsed.");

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
    
    if (genuineHighSeverityCount < 3) {
      validationWarnings.push(`Expected at least 3 concerns with genuine severity >= 3, got ${genuineHighSeverityCount}`);
    }
    
    if (validationWarnings.length > 0) {
      FocalPointLogger.warn("Validation", validationWarnings.join("; "));
    }

    res.json({
      personaId: "acquisitions_director",
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      ...report
    });

  } catch (error: any) {
    FocalPointLogger.error("API_Call", error);
    res.status(500).json({ error: `Screening failed: ${error.message}` });
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
