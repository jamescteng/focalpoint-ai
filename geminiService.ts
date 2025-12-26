
import { GoogleGenAI, Type } from "@google/genai";
import { Persona, AgentReport, Project } from "./types";

export const fileToBytes = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Isolates and cleans JSON from potentially messy model output.
 */
const cleanAndParseJSON = (text: string) => {
  try {
    // Attempt direct parse first
    return JSON.parse(text);
  } catch (e) {
    // Locate the first '{' and the last '}' to strip markdown or meta-talk
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const cleanJson = text.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(cleanJson);
      } catch (innerError) {
        console.error("Failed to parse cleaned JSON:", cleanJson);
        throw innerError;
      }
    }
    throw new Error("No valid JSON object found in response.");
  }
};

export const generateAgentReport = async (
  persona: Persona,
  project: Project,
  videoBase64?: string
): Promise<AgentReport> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-3-pro-preview";

  const parts: any[] = [];

  // Multimodal Video Part
  if (videoBase64) {
    parts.push({
      inlineData: {
        mimeType: project.videoFile?.type || "video/mp4",
        data: videoBase64
      }
    });
  }

  // User Query Part
  const userPrompt = `
    Analyze the uploaded film " ${project.title} ".
    
    SYNOPSIS: ${project.synopsis}
    SCRIPT/DIALOGUE CONTEXT: ${project.srtContent.substring(0, 2500)}

    TASK:
    1. Watch the video for technical and emotional quality.
    2. Provide a 300-word critical summary.
    3. Identify 10 timestamped highlights/lowlights.
    4. Answer these specific focus group questions:
    ${project.questions.map((q, i) => `- ${q}`).join('\n')}
    
    OUTPUT: Provide only valid JSON. Do not include any commentary outside the JSON block.
  `;

  parts.push({ text: userPrompt });

  const systemInstruction = `
    You are ${persona.name}, ${persona.role}. 
    PROFILE: ${persona.description}
    DEMOGRAPHICS: Age ${persona.demographics.age}, Segment: ${persona.demographics.segment}
    BACKGROUND: ${persona.demographics.background}
    
    CRITICAL LENS: You are a professional acquisitions executive. You are looking for flaws, commercial potential, and emotional resonance. 
    Be honest, specific, and professional. 
    
    STRICT JSON RULE: You MUST output valid JSON following the provided schema. 
    No markdown backticks. No "End of Output" text. No conversational filler.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 12000 },
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
    console.error(`Gemini Service Error:`, error);
    if (error?.message?.includes("Requested entity was not found")) {
        throw error;
    }
    // Re-throw to show error in UI
    throw new Error(`Analysis failed for ${persona.name}: ${error.message}`);
  }
};
