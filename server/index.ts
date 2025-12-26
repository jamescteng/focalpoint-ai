import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? 5000 : 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const MAX_VIDEO_SIZE_MB = 2000;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

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
  info: (stage: string, data: any) => console.debug(`[FocalPoint][INFO][${stage}]`, data),
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

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Server configuration error: API key not set.");
  }
  return new GoogleGenAI({ apiKey });
};

app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No video file provided." });
    }

    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    FocalPointLogger.info("Upload_Start", { name: file.originalname, size: `${fileSizeMB} MB` });

    const ai = getAI();

    const uploadedFile = await ai.files.upload({
      file: file.path,
      config: {
        mimeType: file.mimetype
      }
    });

    FocalPointLogger.info("Upload_Complete", { name: uploadedFile.name, uri: uploadedFile.uri });

    let fileInfo = await ai.files.get({ name: uploadedFile.name! });
    let attempts = 0;
    const maxAttempts = 60;

    while (fileInfo.state === "PROCESSING" && attempts < maxAttempts) {
      FocalPointLogger.info("Processing", `Waiting for video processing... (${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      fileInfo = await ai.files.get({ name: uploadedFile.name! });
      attempts++;
    }

    fs.unlink(file.path, () => {});

    if (fileInfo.state === "FAILED") {
      return res.status(500).json({ error: "Video processing failed. Please try a different video format." });
    }

    if (fileInfo.state === "PROCESSING") {
      return res.status(500).json({ error: "Video processing timed out. Please try a shorter or smaller video." });
    }

    FocalPointLogger.info("Processing_Complete", { state: fileInfo.state });

    res.json({
      fileUri: fileInfo.uri,
      fileMimeType: file.mimetype,
      fileName: uploadedFile.name
    });

  } catch (error: any) {
    FocalPointLogger.error("Upload", error);
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
      2. Detailed timestamped observations (10 points).
      3. Direct responses to user-defined research objectives:
      ${questions.map((q, i) => `Objective ${i + 1}: ${q}`).join('\n')}
      
      CONSTRAINTS:
      - Respond strictly in ${langName}.
      - Ensure output is structured as valid JSON.
    `;

    const systemInstruction = `
      IDENTITY: You are a Senior Acquisitions Director at a major independent film distribution company.
      LENS: Acquisitions, pacing, and commercial viability.
      LANGUAGE: You MUST communicate your entire report in ${langName}.
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
                  type: { type: Type.STRING, enum: ["highlight", "lowlight"] },
                  comment: { type: Type.STRING }
                },
                required: ["timestamp", "seconds", "type", "comment"]
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
          required: ["summary", "highlights", "answers"]
        }
      }
    });

    const report = safeParseReport(response.text || "{}");
    FocalPointLogger.info("API_Success", "Report synthesized and parsed.");

    res.json({
      personaId: "acquisitions_director",
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
  FocalPointLogger.error("Uncaught_Exception", error);
});

process.on('unhandledRejection', (reason, promise) => {
  FocalPointLogger.error("Unhandled_Rejection", { reason, promise });
});

const host = isProduction ? '0.0.0.0' : 'localhost';
app.listen(PORT, host, () => {
  console.log(`[FocalPoint] Backend server running on http://${host}:${PORT}`);
});
