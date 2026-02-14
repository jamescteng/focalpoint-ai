import { Router } from 'express';
import { GoogleGenAI, Type, createPartFromUri, createUserContent } from "@google/genai";
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
}

const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";
const API_TIMEOUT_MS = 120000;

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

function shouldTryFallbackModel(error: any): boolean {
  return isTransientError(error);
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
  }
): Promise<{ response: any; modelUsed: string }> {
  const systemInstruction = persona.systemInstruction(params.langName);
  const userPrompt = persona.userPrompt({
    title: params.title,
    synopsis: params.synopsis,
    srtContent: params.srtContent,
    questions: params.questions,
    langName: params.langName
  });

  const videoPart = params.youtubeUrl
    ? { fileData: { fileUri: params.youtubeUrl, mimeType: 'video/*' } }
    : createPartFromUri(params.fileUri!, params.fileMimeType || 'video/mp4');

  const requestConfig = {
    contents: {
      parts: [
        videoPart,
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
      }
    }
  };

  FocalPointLogger.info("API_Call", { 
    model: PRIMARY_MODEL, 
    persona: persona.id, 
    fileUri: params.fileUri,
    youtubeUrl: params.youtubeUrl ? '[YouTube]' : undefined
  });

  try {
    const response = await withRetries(
      () => withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          ...requestConfig
        }),
        API_TIMEOUT_MS,
        `${PRIMARY_MODEL}_${persona.id}`
      ),
      `Gemini_${PRIMARY_MODEL}_${persona.id}`
    );
    return { response, modelUsed: PRIMARY_MODEL };
  } catch (primaryError: any) {
    if (shouldTryFallbackModel(primaryError)) {
      FocalPointLogger.warn("Model_Fallback", `${PRIMARY_MODEL} failed after retries, falling back to ${FALLBACK_MODEL}`);
      
      FocalPointLogger.info("API_Call", { 
        model: FALLBACK_MODEL, 
        persona: persona.id, 
        fileUri: params.fileUri,
        youtubeUrl: params.youtubeUrl ? '[YouTube]' : undefined,
        fallback: true
      });

      try {
        const response = await withRetries(
          () => withTimeout(
            ai.models.generateContent({
              model: FALLBACK_MODEL,
              ...requestConfig
            }),
            API_TIMEOUT_MS,
            `${FALLBACK_MODEL}_${persona.id}`
          ),
          `Gemini_${FALLBACK_MODEL}_${persona.id}`
        );
        return { response, modelUsed: FALLBACK_MODEL };
      } catch (fallbackError: any) {
        FocalPointLogger.error("Fallback_Also_Failed", `Both ${PRIMARY_MODEL} and ${FALLBACK_MODEL} failed for ${persona.id}: ${fallbackError.message}`);
        throw fallbackError;
      }
    }
    throw primaryError;
  }
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
  }
): Promise<{ personaId: string; status: 'success' | 'error'; report?: any; error?: string; validationWarnings?: string[]; modelUsed?: string }> {
  try {
    const { response, modelUsed } = await callGeminiWithFallback(ai, persona, params);

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    const report = JSON.parse(text);
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
  }
): Promise<any> {
  const items = [
    ...(report.highlights || []).map((h: any, i: number) => ({
      index: i,
      type: 'highlight' as const,
      timestamp: h.timestamp,
      seconds: h.seconds,
      evidence: h.timecode_evidence,
      confidence: h.timecode_confidence,
      description: h.summary,
    })),
    ...(report.concerns || []).map((c: any, i: number) => ({
      index: i,
      type: 'concern' as const,
      timestamp: c.timestamp,
      seconds: c.seconds,
      evidence: c.timecode_evidence,
      confidence: c.timecode_confidence,
      description: c.issue,
    })),
  ];

  const itemsList = items.map((item, idx) =>
    `[${idx}] ${item.type.toUpperCase()} | claimed: ${item.timestamp} (${item.seconds}s) | evidence: "${item.evidence}" | confidence: ${item.confidence} | "${item.description}"`
  ).join('\n');

  const verifyPrompt = `
You are a timestamp verification specialist. You have already analyzed this film. Now verify the following ${items.length} timestamps against the actual video.

FILM: "${params.title}"

For each item below, locate the described moment in the video and verify whether the claimed timestamp is correct.

ITEMS TO VERIFY:
${itemsList}

INSTRUCTIONS:
1. For each item, find the actual moment in the video that matches the description and evidence.
2. If the claimed timestamp is correct (within 10 seconds), keep it.
3. If the claimed timestamp is WRONG, provide the corrected timestamp.
4. Update the confidence based on your verification.

Respond strictly in JSON. Return an array of objects, one per item, in the same order:
{
  "verified": [
    {
      "index": 0,
      "original_seconds": 120,
      "corrected_seconds": 135,
      "corrected_timestamp": "2:15",
      "confidence": "high",
      "evidence": "Close-up of the main character entering the building",
      "changed": true
    }
  ]
}

If the original timestamp is accurate (within 10 seconds), set "changed" to false and keep the original values.
Only set "changed" to true if you found a meaningful discrepancy.
`;

  let cacheName: string | null = null;
  const isYoutube = !!params.youtubeUrl;

  try {
    const videoPart = isYoutube
      ? { fileData: { fileUri: params.youtubeUrl!, mimeType: 'video/*' } }
      : createPartFromUri(params.fileUri!, params.fileMimeType || 'video/mp4');

    let response;

    if (isYoutube) {
      FocalPointLogger.info("Grounding_Direct", { reason: 'YouTube URL (no cache)' });
      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: {
            parts: [videoPart, { text: verifyPrompt }]
          },
          config: {
            systemInstruction: `You are a precise video timestamp verifier. Your job is to verify claimed timestamps against the actual video content. Respond in JSON only.`,
            responseMimeType: "application/json",
          }
        }),
        API_TIMEOUT_MS,
        'Grounding_Verify_YouTube'
      );
    } else {
      const cache = await ai.caches.create({
        model: PRIMARY_MODEL,
        config: {
          contents: [createUserContent(videoPart)],
          systemInstruction: `You are a precise video timestamp verifier. Your job is to verify claimed timestamps against the actual video content. Respond in JSON only.`,
          ttl: '300s',
        }
      });

      cacheName = cache.name!;
      FocalPointLogger.info("Grounding_Cache_Created", { cacheName, model: PRIMARY_MODEL });

      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: verifyPrompt,
          config: {
            cachedContent: cacheName,
            responseMimeType: "application/json",
          }
        }),
        API_TIMEOUT_MS,
        'Grounding_Verify'
      );
    }

    const text = response.text || '';
    const parsed = JSON.parse(text);
    const verified = parsed.verified || parsed;

    let correctedCount = 0;

    for (const v of verified) {
      const item = items[v.index];
      if (!item) continue;

      if (v.changed) {
        correctedCount++;
        if (item.type === 'highlight') {
          report.highlights[item.index].seconds = v.corrected_seconds;
          report.highlights[item.index].timestamp = v.corrected_timestamp;
          report.highlights[item.index].timecode_confidence = v.confidence;
          if (v.evidence) report.highlights[item.index].timecode_evidence = v.evidence;
        } else {
          report.concerns[item.index].seconds = v.corrected_seconds;
          report.concerns[item.index].timestamp = v.corrected_timestamp;
          report.concerns[item.index].timecode_confidence = v.confidence;
          if (v.evidence) report.concerns[item.index].timecode_evidence = v.evidence;
        }
      } else {
        if (item.type === 'highlight') {
          report.highlights[item.index].timecode_confidence = v.confidence || item.confidence;
        } else {
          report.concerns[item.index].timecode_confidence = v.confidence || item.confidence;
        }
      }
    }

    FocalPointLogger.info("Grounding_Complete", { correctedCount, totalItems: items.length });
    return report;

  } catch (error: any) {
    FocalPointLogger.warn("Grounding_Failed", `Skipping grounding pass: ${error.message}`);
    return report;
  } finally {
    if (cacheName) {
      ai.caches.delete({ name: cacheName }).catch(err => {
        FocalPointLogger.warn("Grounding_Cache_Cleanup", `Failed to delete cache: ${err.message}`);
      });
    }
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
    FocalPointLogger.error("Analysis_Job_Error", { jobId, error: error.message });
    await db.update(analysisJobs)
      .set({ status: 'failed', lastError: error.message, completedAt: new Date() })
      .where(eq(analysisJobs.jobId, jobId));
  }
}

router.post('/', analyzeLimiter, async (req, res) => {
  try {
    const { title, synopsis, srtContent, questions, language, fileUri, fileMimeType, youtubeUrl, personaIds, sessionId } = req.body as AnalyzeRequestExtended;

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

      processAnalysisJob(jobId, sessionId, personaId, {
        title,
        synopsis,
        srtContent,
        questions,
        langName,
        fileUri: hasFileUri ? fileUri : undefined,
        fileMimeType: hasFileUri ? fileMimeType : undefined,
        youtubeUrl: hasYoutube ? youtubeUrl : undefined
      }).catch(err => {
        FocalPointLogger.error("Analysis_Background_Error", { jobId, error: err.message });
      });
    }

    FocalPointLogger.info("Analysis_Jobs_Created", { 
      jobIds,
      sessionId,
      personas: selectedPersonaIds,
      youtubeUrl: hasYoutube ? '[YouTube]' : undefined
    });

    res.json({ jobIds, status: 'pending' });

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
