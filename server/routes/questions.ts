import { Router } from 'express';
import { GoogleGenAI, Type, MediaResolution } from "@google/genai";
import { getPersonaById } from '../personas.js';
import { FocalPointLogger } from '../utils/logger.js';
import { analyzeLimiter } from '../middleware/rateLimiting.js';
import { db } from '../db.js';
import { sessions, reports, uploads } from '../../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { ensureVideoCache } from '../services/cacheService.js';

const router = Router();
const PRIMARY_MODEL = 'gemini-1.5-pro-001';
const API_TIMEOUT_MS = 120_000;

function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  return new GoogleGenAI({ apiKey });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

router.post('/', analyzeLimiter, async (req, res) => {
  try {
    const { sessionId, personaId, questions } = req.body;

    if (!sessionId || typeof sessionId !== 'number') {
      return res.status(400).json({ error: "Session ID is required." });
    }

    if (!personaId || typeof personaId !== 'string') {
      return res.status(400).json({ error: "Persona ID is required." });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "At least one question is required." });
    }

    if (questions.length > 10) {
      return res.status(400).json({ error: "Maximum 10 questions allowed." });
    }

    for (const q of questions) {
      if (typeof q !== 'string' || q.trim().length === 0 || q.length > 500) {
        return res.status(400).json({ error: "Each question must be a non-empty string under 500 characters." });
      }
    }

    const persona = getPersonaById(personaId);
    if (!persona) {
      return res.status(400).json({ error: `Invalid persona: ${personaId}` });
    }

    const [session] = await db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    const langName = session.language === 'zh-TW' ? 'Traditional Chinese (Taiwan)' : 'English';

    const isYoutube = !!session.youtubeUrl;
    let cacheName: string | null = null;

    if (!isYoutube && session.fileUri) {
      const [upload] = await db.select()
        .from(uploads)
        .where(eq(uploads.geminiFileUri, session.fileUri))
        .limit(1);

      if (upload) {
        const ai = getAI();
        cacheName = await ensureVideoCache(
          ai,
          upload.uploadId,
          session.fileUri,
          session.fileMimeType || 'video/mp4'
        );
      }
    }

    FocalPointLogger.info("Questions_Start", {
      sessionId,
      personaId,
      questionCount: questions.length,
      cached: !!cacheName,
      isYoutube
    });

    const ai = getAI();

    const questionsPrompt = `
You are answering follow-up research questions about a film you have already analyzed.

FILM: "${session.title}"
SYNOPSIS: ${session.synopsis || 'Not provided'}

QUESTIONS FROM THE FILMMAKER:
${questions.map((q: string, i: number) => `Question ${i + 1}: ${q}`).join('\n')}

INSTRUCTIONS:
1. Answer each question based on your analysis of the video content.
2. Be specific and reference actual moments, scenes, or elements from the film.
3. Each answer should be 100-300 words.
4. Respond in ${langName}.
5. Stay in character as your assigned persona throughout.
`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
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
      required: ["answers"]
    };

    let response;

    if (cacheName) {
      FocalPointLogger.info("Questions_Cached", { cacheName, personaId, model: PRIMARY_MODEL });
      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: questionsPrompt,
          config: {
            cachedContent: cacheName,
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            responseMimeType: "application/json",
            responseSchema,
          }
        }),
        API_TIMEOUT_MS,
        `Questions_${personaId}_cached`
      );
    } else if (isYoutube && session.youtubeUrl) {
      FocalPointLogger.info("Questions_YouTube", { personaId });
      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: {
            parts: [
              { fileData: { fileUri: session.youtubeUrl, mimeType: 'video/*' } },
              { text: questionsPrompt }
            ]
          },
          config: {
            systemInstruction: persona.systemInstruction(langName),
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            responseMimeType: "application/json",
            responseSchema,
          }
        }),
        API_TIMEOUT_MS,
        `Questions_${personaId}_youtube`
      );
    } else if (session.fileUri) {
      FocalPointLogger.info("Questions_Direct", { personaId, reason: 'No cache available' });
      const { createPartFromUri } = await import("@google/genai");
      const videoPart = createPartFromUri(session.fileUri, session.fileMimeType || 'video/mp4');
      response = await withTimeout(
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents: {
            parts: [
              videoPart,
              { text: questionsPrompt }
            ]
          },
          config: {
            systemInstruction: persona.systemInstruction(langName),
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            responseMimeType: "application/json",
            responseSchema,
          }
        }),
        API_TIMEOUT_MS,
        `Questions_${personaId}_direct`
      );
    } else {
      return res.status(400).json({ error: "No video source available for this session." });
    }

    const text = response.text || '';
    const parsed = JSON.parse(text);
    const answers = parsed.answers || [];

    const [existingReport] = await db.select()
      .from(reports)
      .where(and(eq(reports.sessionId, sessionId), eq(reports.personaId, personaId)))
      .limit(1);

    if (existingReport) {
      const existingAnswers = (existingReport.answers as any[]) || [];
      const mergedAnswers = [...existingAnswers, ...answers];

      await db.update(reports)
        .set({ answers: mergedAnswers })
        .where(eq(reports.id, existingReport.id));
    }

    await db.update(sessions)
      .set({ 
        questions: questions,
        updatedAt: new Date() 
      })
      .where(eq(sessions.id, sessionId));

    FocalPointLogger.info("Questions_Complete", {
      sessionId,
      personaId,
      answerCount: answers.length,
      cached: !!cacheName
    });

    res.json({ answers, personaId, sessionId });

  } catch (error: any) {
    FocalPointLogger.error("Questions_Error", error.message);
    res.status(500).json({ error: "Failed to answer questions. Please try again." });
  }
});

export default router;
