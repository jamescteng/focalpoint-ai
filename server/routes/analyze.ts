import { Router } from 'express';
import { GoogleGenAI, Type, createPartFromUri, createUserContent, MediaResolution } from "@google/genai";
import { getPersonaById, getAllPersonas, PersonaConfig } from '../personas.js';
import { FocalPointLogger } from '../utils/logger.js';
import { analyzeLimiter, analyzeStatusLimiter } from '../middleware/rateLimiting.js';
import { 
  MAX_TITLE_LENGTH,
  MAX_SYNOPSIS_LENGTH,
  MAX_SRT_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS_COUNT,
  VALID_LANGUAGES
} from '../middleware/validation.js';
import { db } from '../db.js';
import { analysisJobs } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { ensureVideoCache, findUploadIdByFileUri } from '../services/cacheService.js';

const router = Router();

function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  return new GoogleGenAI({ apiKey });
}

interface AnalyzeRequest {
  title: string;
  synopsis: string;
  srtContent: string;
  questions: string[];
  language: 'en' | 'zh-TW';
  fileUri?: string;
  fileMimeType?: string;
  youtubeUrl?: string;
  personaIds: string[];
  videoDurationSeconds?: number;
}

const PRIMARY_MODEL = "gemini-2.5-flash";
const API_TIMEOUT_MS = 120000;

function getApiTimeout(videoDurationSeconds?: number): number {
  if (!videoDurationSeconds) return API_TIMEOUT_MS;
  if (videoDurationSeconds > 5400) return 300000;
  if (videoDurationSeconds > 3600) return 240000;
  if (videoDurationSeconds > 1800) return 180000;
  return API_TIMEOUT_MS;
}

function serializeFetchError(err: any) {
  const cause = err?.cause;
  return {
    name: err?.name,
    message: err?.message,
    stack: err?.stack?.split('\n').slice(0, 5).join('\n'),
    cause: cause
      ? {
          name: cause?.name,
          message: cause?.message,
          code: cause?.code,
          errno: cause?.errno,
          syscall: cause?.syscall,
          address: cause?.address,
          port: cause?.port,
        }
      : undefined,
  };
}

function isTransientError(error: any): boolean {
  const info = serializeFetchError(error);
  const code = info.cause?.code;
  const message = info.message || '';
  const status = error?.status || error?.httpStatus || error?.statusCode;
  
  const isTransientStatus = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  
  return (
    isTransientStatus ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    message.includes('fetch failed') ||
    message.includes('503') ||
    message.includes('overloaded') ||
    message.includes('UNAVAILABLE') ||
    message.includes('Timeout after')
  );
}


function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
    
    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function withRetries<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts: number = 4
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const info = serializeFetchError(err);
      
      if (!isTransientError(err) || attempt === maxAttempts) {
        FocalPointLogger.error("API_Final_Error", `${label} attempt ${attempt}: ${JSON.stringify(info)}`);
        throw err;
      }
      
      const base = Math.min(5000, 250 * Math.pow(2, attempt - 1));
      const jitter = base * (0.2 * (Math.random() * 2 - 1));
      const delay = Math.max(200, Math.round(base + jitter));
      
      FocalPointLogger.warn("API_Retry", `${label} attempt ${attempt}, retrying in ${delay}ms: ${info.cause?.code || info.message}`);
      
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw lastError;
}

async function callGeminiWithFallback(
  ai: GoogleGenAI,
  persona: PersonaConfig,
  params: {
    title: string;
    synopsis: string;
    srtContent: string;
    questions: string[];
    langName: string;
    fileUri?: string;
    fileMimeType?: string;
    youtubeUrl?: string;
    cacheName?: string;
    videoDurationSeconds?: number;
  }
): Promise<{ response: any; modelUsed: string }> {
  const systemInstruction = persona.systemInstruction(params.langName);
  const userPrompt = persona.userPrompt({
    title: params.title,
    synopsis: params.synopsis,
    srtContent: params.srtContent,
    questions: params.questions,
    langName: params.langName,
    videoDurationSeconds: params.videoDurationSeconds
  });

  const useCached = !!params.cacheName;

  const videoPart = params.youtubeUrl
    ? { fileData: { fileUri: params.youtubeUrl, mimeType: 'video/*' } }
    : createPartFromUri(params.fileUri!, params.fileMimeType || 'video/mp4');

  const requestConfig = useCached ? {
    contents: userPrompt,
    config: {
      cachedContent: params.cacheName!,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(persona),
    }
  } : {
    contents: {
      parts: [
        videoPart,
        { text: userPrompt }
      ]
    },
    config: {
      systemInstruction,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(persona),
    }
  };

  FocalPointLogger.info("API_Call", { 
    model: PRIMARY_MODEL, 
    persona: persona.id, 
    cached: useCached,
    fileUri: params.fileUri,
    youtubeUrl: params.youtubeUrl ? '[YouTube]' : undefined
  });

  const uncachedConfig = {
    contents: {
      parts: [
        videoPart,
        { text: userPrompt }
      ]
    },
    config: {
      systemInstruction,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(persona),
    }
  };

  try {
    const response = await withRetries(
      () => withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          ...requestConfig
        }),
        getApiTimeout(params.videoDurationSeconds),
        `${PRIMARY_MODEL}_${persona.id}`
      ),
      `Gemini_${PRIMARY_MODEL}_${persona.id}`
    );
    return { response, modelUsed: PRIMARY_MODEL };
  } catch (primaryError: any) {
    if (useCached && isCacheError(primaryError)) {
      FocalPointLogger.warn("Cache_Fallback", `Cache expired/invalid for ${persona.id}, retrying without cache`);
      try {
        const response = await withRetries(
          () => withTimeout(
            ai.models.generateContent({
              model: PRIMARY_MODEL,
              ...uncachedConfig
            }),
            getApiTimeout(params.videoDurationSeconds),
            `${PRIMARY_MODEL}_${persona.id}_uncached`
          ),
          `Gemini_${PRIMARY_MODEL}_${persona.id}_uncached`
        );
        return { response, modelUsed: PRIMARY_MODEL };
      } catch (uncachedError: any) {
        FocalPointLogger.error("Cache_Fallback_Failed", `Uncached retry also failed for ${persona.id}: ${uncachedError.message}`);
        throw uncachedError;
      }
    }

    throw primaryError;
  }
}

function isCacheError(error: any): boolean {
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('cache') || msg.includes('expired') || msg.includes('not found') || msg.includes('invalid cached');
}

function buildResponseSchema(persona: PersonaConfig) {
  return {
    type: Type.OBJECT,
    properties: {
      executive_summary: { type: Type.STRING },
      highlights: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: { type: Type.STRING },
            seconds: { type: Type.NUMBER, description: "The absolute start time in total seconds from the beginning of the video. Example: For a clip at 10:05, this value must be 605. Do not provide the duration." },
            timecode_evidence: { type: Type.STRING, description: "Describe the specific visual or audio element visible/audible at this exact moment that proves this timestamp is correct. E.g. 'close-up of protagonist crying', 'explosion sound effect begins', 'title card appears'." },
            timecode_confidence: { type: Type.STRING, enum: ["high", "medium", "low"], description: "How confident you are that this timestamp is accurate. 'high' = you can see/hear the exact moment. 'medium' = approximate based on scene context. 'low' = estimated from narrative position." },
            summary: { type: Type.STRING },
            why_it_works: { type: Type.STRING },
            category: { type: Type.STRING, enum: persona.highlightCategories }
          },
          required: ["timestamp", "seconds", "timecode_evidence", "timecode_confidence", "summary", "why_it_works", "category"]
        }
      },
      concerns: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: { type: Type.STRING },
            seconds: { type: Type.NUMBER, description: "The absolute start time in total seconds from the beginning of the video. Example: For a clip at 10:05, this value must be 605. Do not provide the duration." },
            timecode_evidence: { type: Type.STRING, description: "Describe the specific visual or audio element visible/audible at this exact moment that proves this timestamp is correct. E.g. 'dialogue about the mission begins', 'camera pans to empty room', 'background music shifts tone'." },
            timecode_confidence: { type: Type.STRING, enum: ["high", "medium", "low"], description: "How confident you are that this timestamp is accurate. 'high' = you can see/hear the exact moment. 'medium' = approximate based on scene context. 'low' = estimated from narrative position." },
            issue: { type: Type.STRING },
            impact: { type: Type.STRING },
            severity: { type: Type.NUMBER },
            category: { type: Type.STRING, enum: persona.concernCategories },
            suggested_fix: { type: Type.STRING }
          },
          required: ["timestamp", "seconds", "timecode_evidence", "timecode_confidence", "issue", "impact", "severity", "category", "suggested_fix"]
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
  };
}

async function analyzeWithPersona(
  ai: GoogleGenAI,
  persona: PersonaConfig,
  params: {
    title: string;
    synopsis: string;
    srtContent: string;
    questions: string[];
    langName: string;
    fileUri?: string;
    fileMimeType?: string;
    youtubeUrl?: string;
    cacheName?: string;
    videoDurationSeconds?: number;
  }
): Promise<{ personaId: string; status: 'success' | 'error'; report?: any; error?: string; validationWarnings?: string[]; modelUsed?: string }> {
  try {
    const { response, modelUsed } = await callGeminiWithFallback(ai, persona, params);

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    const report = JSON.parse(text);

    for (const h of report.highlights || []) {
      if (typeof h.seconds === 'number') {
        h.seconds = Math.round(h.seconds / 10) * 10;
      }
    }
    for (const c of report.concerns || []) {
      if (typeof c.seconds === 'number') {
        c.seconds = Math.round(c.seconds / 10) * 10;
      }
    }

    if (params.videoDurationSeconds) {
      const maxSec = params.videoDurationSeconds;
      for (const h of report.highlights || []) {
        if (typeof h.seconds === 'number' && h.seconds > maxSec) {
          h.seconds = Math.min(h.seconds, maxSec);
        }
      }
      for (const c of report.concerns || []) {
        if (typeof c.seconds === 'number' && c.seconds > maxSec) {
          c.seconds = Math.min(c.seconds, maxSec);
        }
      }
    }

    const validationWarnings: string[] = [];
    
    if (report.highlights.length !== 5) {
      validationWarnings.push(`Expected 5 highlights, got ${report.highlights.length}`);
    }
    if (report.concerns.length !== 5) {
      validationWarnings.push(`Expected 5 concerns, got ${report.concerns.length}`);
    }
    
    let genuineHighSeverityCount = 0;
    for (const c of report.concerns || []) {
      if (c.severity >= 3) {
        genuineHighSeverityCount++;
      }
    }
    
    if (genuineHighSeverityCount < persona.minHighSeverityConcerns) {
      validationWarnings.push(`Expected at least ${persona.minHighSeverityConcerns} concerns with severity >= 3, got ${genuineHighSeverityCount}`);
    }
    
    if (validationWarnings.length > 0) {
      FocalPointLogger.warn("Validation", `[${persona.id}] ${validationWarnings.join("; ")}`);
    }

    FocalPointLogger.info("API_Success", { persona: persona.id, modelUsed });

    return {
      personaId: persona.id,
      status: 'success',
      report: {
        executive_summary: report.executive_summary,
        highlights: report.highlights,
        concerns: report.concerns,
        answers: report.answers
      },
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      modelUsed
    };
  } catch (error: any) {
    FocalPointLogger.error("API_Call", `[${persona.id}] ${error.message}`);
    return {
      personaId: persona.id,
      status: 'error' as const,
      error: 'Analysis failed. Please try again.'
    };
  }
}

async function groundTimestamps(
  ai: GoogleGenAI,
  report: any,
  params: {
    title: string;
    fileUri?: string;
    fileMimeType?: string;
    youtubeUrl?: string;
    langName: string;
    cacheName?: string;
    videoDurationSeconds?: number;
  }
): Promise<any> {
  const items = [
    ...(report.highlights || []).map((h: any, i: number) => ({
      index: i,
      type: 'highlight' as const,
      originalSeconds: h.seconds,
      evidence: h.timecode_evidence,
      description: h.summary,
    })),
    ...(report.concerns || []).map((c: any, i: number) => ({
      index: i,
      type: 'concern' as const,
      originalSeconds: c.seconds,
      evidence: c.timecode_evidence,
      description: c.issue,
    })),
  ];

  const itemsList = items.map((item, idx) =>
    `[${idx}] ${item.type.toUpperCase()} | description: "${item.description}" | visual/audio clue: "${item.evidence}"`
  ).join('\n');

  const searchPrompt = `
You are a timestamp retrieval specialist. Search the video for each described moment and return the exact time where it occurs. Do NOT guess — you must locate each event by its visual or audio clue.

FILM: "${params.title}"
${params.videoDurationSeconds ? `VIDEO DURATION: ${params.videoDurationSeconds} seconds. All timestamps MUST be within this range.\n` : ''}
ITEMS TO LOCATE (${items.length} total):
${itemsList}

INSTRUCTIONS:
1. For each item, search the video for the described moment using the visual/audio clue.
2. Return the START second (when the moment begins) and END second (when it ends or transitions).
3. Provide a brief evidence description of what you see/hear at that exact moment.
4. If you cannot confidently locate the moment, set confidence to "low" and provide your best estimate.
5. Round all timestamps to the nearest 10-second increment.

Respond strictly in JSON:
{
  "located": [
    {
      "index": 0,
      "start_seconds": 135,
      "end_seconds": 142,
      "timestamp": "2:15",
      "confidence": "high",
      "evidence": "Close-up of the main character entering the building"
    }
  ]
}
`;

  const isYoutube = !!params.youtubeUrl;
  const useSharedCache = !!params.cacheName;

  try {
    let response;

    if (useSharedCache) {
      FocalPointLogger.info("Grounding_Cached", { cacheName: params.cacheName });
      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: searchPrompt,
          config: {
            cachedContent: params.cacheName!,
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            responseMimeType: "application/json",
          }
        }),
        getApiTimeout(params.videoDurationSeconds),
        'Grounding_Search_Cached'
      );
    } else if (isYoutube) {
      const videoPart = { fileData: { fileUri: params.youtubeUrl!, mimeType: 'video/*' } };
      FocalPointLogger.info("Grounding_Direct", { reason: 'YouTube URL (no cache)' });
      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: {
            parts: [videoPart, { text: searchPrompt }]
          },
          config: {
            systemInstruction: `You are a precise video timestamp retrieval specialist. Search the video for described moments and return exact times. Respond in JSON only.`,
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            responseMimeType: "application/json",
          }
        }),
        getApiTimeout(params.videoDurationSeconds),
        'Grounding_Search_YouTube'
      );
    } else {
      FocalPointLogger.warn("Grounding_Skip", "No cache and not YouTube, skipping grounding");
      return report;
    }

    const text = response.text || '';
    const parsed = JSON.parse(text);
    const located = parsed.located || parsed;

    let correctedCount = 0;
    const DRIFT_THRESHOLD_SECONDS = 10;

    for (const loc of located) {
      const item = items[loc.index];
      if (!item) continue;

      const foundSeconds = loc.start_seconds;
      const delta = Math.abs(foundSeconds - item.originalSeconds);

      let computedConfidence: 'high' | 'medium' | 'low';
      if (loc.confidence === 'low') {
        computedConfidence = 'low';
      } else if (delta <= DRIFT_THRESHOLD_SECONDS) {
        computedConfidence = 'high';
      } else if (delta <= 30) {
        computedConfidence = 'medium';
      } else {
        computedConfidence = 'low';
      }

      const wasChanged = delta > DRIFT_THRESHOLD_SECONDS;

      if (item.type === 'highlight') {
        if (wasChanged) {
          correctedCount++;
          report.highlights[item.index].seconds = foundSeconds;
          report.highlights[item.index].timestamp = loc.timestamp;
        }
        report.highlights[item.index].timecode_confidence = computedConfidence;
        if (loc.evidence) report.highlights[item.index].timecode_evidence = loc.evidence;
      } else {
        if (wasChanged) {
          correctedCount++;
          report.concerns[item.index].seconds = foundSeconds;
          report.concerns[item.index].timestamp = loc.timestamp;
        }
        report.concerns[item.index].timecode_confidence = computedConfidence;
        if (loc.evidence) report.concerns[item.index].timecode_evidence = loc.evidence;
      }
    }

    FocalPointLogger.info("Grounding_Complete", { correctedCount, totalItems: items.length });
    return report;

  } catch (error: any) {
    FocalPointLogger.warn("Grounding_Failed", `Skipping grounding pass: ${error.message}`);
    return report;
  }
}

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

interface AnalyzeRequestExtended extends AnalyzeRequest {
  sessionId?: number;
}

function generateJobId(): string {
  return `aj_${crypto.randomBytes(16).toString('hex')}`;
}

async function processAnalysisJob(
  jobId: string,
  sessionId: number,
  personaId: string,
  params: {
    title: string;
    synopsis: string;
    srtContent: string;
    questions: string[];
    langName: string;
    fileUri?: string;
    fileMimeType?: string;
    youtubeUrl?: string;
    cacheName?: string;
    videoDurationSeconds?: number;
  }
): Promise<void> {
  try {
    const ai = getAI();
    const persona = getPersonaById(personaId);
    
    if (!persona) {
      await db.update(analysisJobs)
        .set({ status: 'failed', lastError: `Invalid persona: ${personaId}`, completedAt: new Date() })
        .where(eq(analysisJobs.jobId, jobId));
      return;
    }

    await db.update(analysisJobs)
      .set({ status: 'processing' })
      .where(eq(analysisJobs.jobId, jobId));

    const result = await analyzeWithPersona(ai, persona, params);

    if (result.status === 'success' && result.report) {
      FocalPointLogger.info("Grounding_Start", { jobId, persona: personaId });
      result.report = await groundTimestamps(ai, result.report, {
        title: params.title,
        fileUri: params.fileUri,
        fileMimeType: params.fileMimeType,
        youtubeUrl: params.youtubeUrl,
        langName: params.langName,
        cacheName: params.cacheName,
        videoDurationSeconds: params.videoDurationSeconds,
      });

      await db.update(analysisJobs)
        .set({ 
          status: 'completed', 
          result: { ...result, sessionId },
          completedAt: new Date() 
        })
        .where(eq(analysisJobs.jobId, jobId));
    } else if (result.status === 'success') {
      await db.update(analysisJobs)
        .set({ 
          status: 'completed', 
          result: { ...result, sessionId },
          completedAt: new Date() 
        })
        .where(eq(analysisJobs.jobId, jobId));
    } else {
      await db.update(analysisJobs)
        .set({ 
          status: 'failed', 
          lastError: result.error || 'Analysis failed',
          completedAt: new Date() 
        })
        .where(eq(analysisJobs.jobId, jobId));
    }
  } catch (error: any) {
    FocalPointLogger.error("Analysis_Job_Error", `${jobId}: ${error.message}`);
    await db.update(analysisJobs)
      .set({ status: 'failed', lastError: error.message, completedAt: new Date() })
      .where(eq(analysisJobs.jobId, jobId));
  }
}

router.post('/', analyzeLimiter, async (req, res) => {
  try {
    const { title, synopsis, srtContent, questions, language, fileUri, fileMimeType, youtubeUrl, personaIds, sessionId, videoDurationSeconds } = req.body as AnalyzeRequestExtended;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required." });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Title too long. Maximum ${MAX_TITLE_LENGTH} characters.` });
    }

    if (synopsis && synopsis.length > MAX_SYNOPSIS_LENGTH) {
      return res.status(400).json({ error: `Synopsis too long. Maximum ${MAX_SYNOPSIS_LENGTH} characters.` });
    }

    if (srtContent && srtContent.length > MAX_SRT_LENGTH) {
      return res.status(400).json({ error: `Subtitle content too large. Maximum ${MAX_SRT_LENGTH / 1000}KB.` });
    }

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

    if (language && !VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: "Invalid language. Supported: en, zh-TW." });
    }

    const hasYoutube = youtubeUrl && isValidYoutubeUrl(youtubeUrl);
    const hasFileUri = fileUri && fileUri.startsWith('https://generativelanguage.googleapis.com/');

    if (!hasYoutube && !hasFileUri) {
      return res.status(400).json({ error: "Video source required. Please upload a video or provide a YouTube URL." });
    }

    if (youtubeUrl && !hasYoutube) {
      return res.status(400).json({ error: "Invalid YouTube URL format." });
    }

    if (fileUri && !hasFileUri) {
      FocalPointLogger.warn("Validation", `Suspicious fileUri: ${fileUri.substring(0, 50)}`);
      return res.status(400).json({ error: "Invalid file URI format." });
    }

    if (!sessionId || typeof sessionId !== 'number') {
      return res.status(400).json({ error: "Session ID is required." });
    }

    const allPersonaIds = getAllPersonas().map(p => p.id);
    const selectedPersonaIds = personaIds && personaIds.length > 0 ? personaIds : ['acquisitions_director'];
    
    for (const id of selectedPersonaIds) {
      if (typeof id !== 'string' || !allPersonaIds.includes(id)) {
        return res.status(400).json({ error: `Invalid persona: ${id}` });
      }
    }

    const langName = language === 'zh-TW' ? 'Traditional Chinese (Taiwan)' : 'English';
    const jobIds: string[] = [];

    for (const personaId of selectedPersonaIds) {
      const jobId = generateJobId();
      jobIds.push(jobId);

      await db.insert(analysisJobs).values({
        jobId,
        sessionId,
        personaId,
        status: 'pending',
      });
    }

    FocalPointLogger.info("Analysis_Jobs_Created", { 
      jobIds,
      sessionId,
      personas: selectedPersonaIds,
      youtubeUrl: hasYoutube ? '[YouTube]' : undefined
    });

    res.json({ jobIds, status: 'pending' });

    const isUploadedFile = hasFileUri && !hasYoutube;
    let cacheName: string | undefined;
    let cacheUploadId: string | undefined;

    if (isUploadedFile) {
      try {
        const ai = getAI();
        cacheUploadId = await findUploadIdByFileUri(fileUri!);
        if (cacheUploadId) {
          const result = await ensureVideoCache(ai, cacheUploadId, fileUri!, fileMimeType || 'video/mp4');
          cacheName = result ?? undefined;
          FocalPointLogger.info("Global_Cache_Created", { cacheName, sessionId, jobCount: jobIds.length });
        }
      } catch (err: any) {
        FocalPointLogger.warn("Global_Cache_Failed", `Proceeding without cache: ${err.message}`);
      }
    }

    const jobPromises = selectedPersonaIds.map((personaId, i) =>
      processAnalysisJob(jobIds[i], sessionId, personaId, {
        title,
        synopsis,
        srtContent,
        questions,
        langName,
        fileUri: hasFileUri ? fileUri : undefined,
        fileMimeType: hasFileUri ? fileMimeType : undefined,
        youtubeUrl: hasYoutube ? youtubeUrl : undefined,
        cacheName,
        videoDurationSeconds,
      }).catch(err => {
        FocalPointLogger.error("Analysis_Background_Error", { jobId: jobIds[i], error: err.message });
      })
    );

    Promise.allSettled(jobPromises).then(async () => {
      if (cacheName) {
        FocalPointLogger.info("Global_Cache_Kept", { cacheName, sessionId, reason: 'Persistent cache for follow-up questions' });
      }
    });

  } catch (error: any) {
    FocalPointLogger.error("API_Call", error);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

router.get('/status/:jobId', analyzeStatusLimiter, async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || !jobId.startsWith('aj_')) {
      return res.status(400).json({ error: "Invalid job ID." });
    }

    const [job] = await db.select()
      .from(analysisJobs)
      .where(eq(analysisJobs.jobId, jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    res.json({
      jobId: job.jobId,
      sessionId: job.sessionId,
      personaId: job.personaId,
      status: job.status,
      result: job.status === 'completed' ? job.result : undefined,
      error: job.status === 'failed' ? job.lastError : undefined,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });

  } catch (error: any) {
    FocalPointLogger.error("Analysis_Status_Error", error);
    res.status(500).json({ error: "Failed to get job status." });
  }
});

router.get('/status/session/:sessionId', analyzeStatusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);

    if (isNaN(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID." });
    }

    const jobs = await db.select()
      .from(analysisJobs)
      .where(eq(analysisJobs.sessionId, sessionId));

    res.json({
      sessionId,
      jobs: jobs.map(job => ({
        jobId: job.jobId,
        personaId: job.personaId,
        status: job.status,
        result: job.status === 'completed' ? job.result : undefined,
        error: job.status === 'failed' ? job.lastError : undefined,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      })),
    });

  } catch (error: any) {
    FocalPointLogger.error("Analysis_Session_Status_Error", error);
    res.status(500).json({ error: "Failed to get session jobs." });
  }
});

export default router;
