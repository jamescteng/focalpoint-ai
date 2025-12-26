
import { GoogleGenAI, Type } from "@google/genai";
import { Persona, AgentReport, Project } from "./types";

/**
 * Validates the runtime environment and project data for security.
 */
const validateContext = (project: Project) => {
  if (!process.env.API_KEY) {
    throw new Error("SEC_ERR: API Key missing from environment.");
  }
  if (!project.title || !project.synopsis) {
    throw new Error("DATA_ERR: Essential project metadata is missing.");
  }
};

/**
 * Converts file to Base64 with a safety buffer check.
 */
export const fileToBytes = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Debug: Monitor file size ingress
    console.debug(`[FocalPoint Debug] Processing asset: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result) {
        return reject(new Error("FILE_ERR: Empty result from reader."));
      }
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("FILE_ERR: Failed to read asset stream."));
    reader.readAsDataURL(file);
  });
};

const cleanAndParseJSON = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.debug("[FocalPoint Debug] Raw response was not pure JSON, attempting extraction...", text);
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const cleanJson = text.substring(firstBrace, lastBrace + 1);
      return JSON.parse(cleanJson);
    }
    throw new Error("PARSE_ERR: Model response format invalid.");
  }
};

export const generateAgentReport = async (
  persona: Persona,
  project: Project,
  videoBase64?: string
): Promise<AgentReport> => {
  // Security check
  validateContext(project);

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-3-flash-preview"; 

  const parts: any[] = [];

  // Add video as inline data
  if (videoBase64) {
    parts.push({
      inlineData: {
        data: videoBase64,
        mimeType: project.videoFile?.type || 'video/mp4'
      }
    });
  }

  const langName = project.language === 'zh-TW' ? 'Traditional Chinese (Taiwan)' : 'English';

  const userPrompt = `
    ACTION: Perform an Acquisitions Appraisal for "${project.title}".
    
    METADATA:
    Synopsis: ${project.synopsis}
    Script Content: ${project.srtContent.substring(0, 4000)}

    OBJECTIVES:
    1. Critical Executive Summary (approx 300 words).
    2. Visual/Temporal Log (10 timestamped critical points).
    3. Direct answers to user inquiries:
    ${project.questions.map((q, i) => `- ${q}`).join('\n')}
    
    LOCALIZATION:
    All content (summary, highlights, and answers) MUST be written in ${langName}.
  `;

  parts.push({ text: userPrompt });

  const systemInstruction = `
    IDENTITY: You are ${persona.name}, ${persona.role}. 
    BIO: ${persona.description}
    BEHAVIOR: Sharp, critical, and objective. You analyze for commercial viability and artistic merit.
    OUTPUT: Valid JSON only. Use the requested language (${langName}) for all text fields.
  `;

  console.debug(`[FocalPoint Debug] Initiating analysis pass for ${persona.name}. Target Language: ${langName}`);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
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

    const result = cleanAndParseJSON(response.text || "{}");
    return {
      personaId: persona.id,
      ...result
    };
  } catch (error: any) {
    console.error("[FocalPoint Security/API Error]", error);
    throw new Error(`Analysis failed: ${error.message}`);
  }
};
