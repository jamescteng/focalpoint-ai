import { Router } from 'express';
import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";
import { getPersonaById, getAllPersonas, PersonaConfig } from '../personas.js';
import { FocalPointLogger } from '../utils/logger.js';
import { analyzeLimiter } from '../middleware/rateLimiting.js';
import { 
  MAX_TITLE_LENGTH,
  MAX_SYNOPSIS_LENGTH,
  MAX_SRT_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS_COUNT,
  VALID_LANGUAGES
} from '../middleware/validation.js';

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

const PRIMARY_MODEL = "gemini-3-pro-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

function isModelOverloadedError(error: any): boolean {
  const message = error?.message || '';
  const status = error?.status;
  return (
    status === 503 ||
    message.includes('503') ||
    message.includes('overloaded') ||
    message.includes('UNAVAILABLE')
  );
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
                seconds: { type: Type.NUMBER, description: "The absolute start time in total seconds from the beginning of the video. Example: For a clip at 10:05, this value must be 605. Do not provide the duration." },
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
  };

  FocalPointLogger.info("API_Call", { 
    model: PRIMARY_MODEL, 
    persona: persona.id, 
    fileUri: params.fileUri,
    youtubeUrl: params.youtubeUrl ? '[YouTube]' : undefined
  });

  try {
    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      ...requestConfig
    });
    return { response, modelUsed: PRIMARY_MODEL };
  } catch (primaryError: any) {
    if (isModelOverloadedError(primaryError)) {
      FocalPointLogger.warn("Model_Fallback", `${PRIMARY_MODEL} overloaded (503), falling back to ${FALLBACK_MODEL}`);
      
      FocalPointLogger.info("API_Call", { 
        model: FALLBACK_MODEL, 
        persona: persona.id, 
        fileUri: params.fileUri,
        youtubeUrl: params.youtubeUrl ? '[YouTube]' : undefined,
        fallback: true
      });

      const response = await ai.models.generateContent({
        model: FALLBACK_MODEL,
        ...requestConfig
      });
      return { response, modelUsed: FALLBACK_MODEL };
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

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

router.post('/', analyzeLimiter, async (req, res) => {
  try {
    const { title, synopsis, srtContent, questions, language, fileUri, fileMimeType, youtubeUrl, personaIds } = req.body as AnalyzeRequest;

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

    FocalPointLogger.info("Analysis_Start", { 
      personas: personas.map(p => p.id), 
      fileUri: hasFileUri ? fileUri : undefined,
      youtubeUrl: hasYoutube ? '[YouTube]' : undefined
    });

    const results = await Promise.all(
      personas.map(persona => 
        analyzeWithPersona(ai, persona, {
          title,
          synopsis,
          srtContent,
          questions,
          langName,
          fileUri: hasFileUri ? fileUri : undefined,
          fileMimeType: hasFileUri ? fileMimeType : undefined,
          youtubeUrl: hasYoutube ? youtubeUrl : undefined
        })
      )
    );

    FocalPointLogger.info("Analysis_Complete", { 
      total: results.length, 
      successful: results.filter(r => r.status === 'success').length 
    });

    res.json({ results });

  } catch (error: any) {
    FocalPointLogger.error("API_Call", error);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

export default router;
