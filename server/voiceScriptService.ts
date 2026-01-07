import { createHash } from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { VoiceReportScript } from '../shared/schema';
import { Highlight, Concern, QuestionAnswer } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface PersonaReport {
  personaId: string;
  executive_summary: string;
  highlights: Highlight[];
  concerns: Concern[];
  answers: QuestionAnswer[];
}

export interface PersonaMeta {
  personaId: string;
  name: string;
  role: string;
}

export function generateReportHash(report: PersonaReport): string {
  const content = JSON.stringify({
    personaId: report.personaId,
    executive_summary: report.executive_summary,
    highlights: report.highlights,
    concerns: report.concerns,
    answers: report.answers
  });
  return createHash('sha256').update(content).digest('hex');
}

function buildDeterministicScript(
  persona: PersonaMeta,
  report: PersonaReport,
  language: 'en' | 'zh-TW'
): VoiceReportScript {
  const sections: VoiceReportScript['sections'] = [];
  const coverage = {
    highlights: new Array(5).fill(false),
    concerns: new Array(5).fill(false),
    answers: new Array(report.answers.length).fill(false),
    timestampsUsed: [] as string[],
    wordCount: 0
  };

  const isEnglish = language === 'en';

  sections.push({
    sectionId: 'OPEN',
    lines: isEnglish ? [
      { text: `This is ${persona.name}, ${persona.role}. I just finished watching the film.`, refs: [] },
      { text: `Here are my thoughts on what stood out and what needs attention.`, refs: [{ type: 'summary' }] }
    ] : [
      { text: `這是${persona.name}，${persona.role}。我剛看完這部影片。`, refs: [] },
      { text: `以下是我對亮點與需要注意之處的想法。`, refs: [{ type: 'summary' }] }
    ]
  });

  const highlightLines: VoiceReportScript['sections'][0]['lines'] = [];
  report.highlights.slice(0, 5).forEach((h, i) => {
    coverage.highlights[i] = true;
    if (h.timestamp) coverage.timestampsUsed.push(h.timestamp);
    
    const timePhrase = isEnglish 
      ? `Around ${h.timestamp}` 
      : `大約在 ${h.timestamp}`;
    
    highlightLines.push({
      text: isEnglish 
        ? `${timePhrase}, ${h.summary}. ${h.why_it_works}`
        : `${timePhrase}，${h.summary}。${h.why_it_works}`,
      refs: [{ type: 'highlight', index: i, timestamp: h.timestamp, seconds: h.seconds }]
    });
  });
  sections.push({ sectionId: 'HIGHLIGHTS', lines: highlightLines });

  const concernLines: VoiceReportScript['sections'][0]['lines'] = [];
  report.concerns.slice(0, 5).forEach((c, i) => {
    coverage.concerns[i] = true;
    if (c.timestamp) coverage.timestampsUsed.push(c.timestamp);
    
    const timePhrase = isEnglish 
      ? `At ${c.timestamp}` 
      : `在 ${c.timestamp}`;
    
    concernLines.push({
      text: isEnglish
        ? `${timePhrase}, ${c.issue}. ${c.impact} Consider ${c.suggested_fix.toLowerCase()}.`
        : `${timePhrase}，${c.issue}。${c.impact} 建議${c.suggested_fix}。`,
      refs: [{ type: 'concern', index: i, timestamp: c.timestamp, seconds: c.seconds }]
    });
  });
  sections.push({ sectionId: 'CONCERNS', lines: concernLines });

  if (report.answers.length > 0) {
    const answerLines: VoiceReportScript['sections'][0]['lines'] = [];
    const maxAnswers = Math.min(report.answers.length, 3);
    
    for (let i = 0; i < maxAnswers; i++) {
      const a = report.answers[i];
      coverage.answers[i] = true;
      answerLines.push({
        text: isEnglish
          ? `Regarding "${a.question}" — ${a.answer}`
          : `關於「${a.question}」— ${a.answer}`,
        refs: [{ type: 'answer', index: i }]
      });
    }
    
    if (report.answers.length > 3) {
      for (let i = 3; i < report.answers.length; i++) {
        coverage.answers[i] = true;
      }
      answerLines.push({
        text: isEnglish
          ? `The remaining questions have been addressed in the written report.`
          : `其餘問題已在書面報告中回答。`,
        refs: report.answers.slice(3).map((_, idx) => ({ type: 'answer' as const, index: idx + 3 }))
      });
    }
    
    sections.push({ sectionId: 'OBJECTIVES', lines: answerLines });
  }

  sections.push({
    sectionId: 'CLOSE',
    lines: isEnglish ? [
      { text: `Overall, there's real potential here. With some focused revisions, this could really connect with audiences.`, refs: [{ type: 'summary' }] },
      { text: `Keep pushing forward.`, refs: [] }
    ] : [
      { text: `整體而言，這部作品有真正的潛力。經過一些重點修改，它能夠真正打動觀眾。`, refs: [{ type: 'summary' }] },
      { text: `繼續努力。`, refs: [] }
    ]
  });

  const allText = sections.flatMap(s => s.lines.map(l => l.text)).join(' ');
  coverage.wordCount = isEnglish 
    ? allText.split(/\s+/).length 
    : allText.length;

  return {
    version: '1.0',
    language,
    persona: {
      personaId: persona.personaId,
      name: persona.name,
      role: persona.role
    },
    runtimeTargetSeconds: 210,
    sections,
    coverage: {
      highlights: coverage.highlights,
      concerns: coverage.concerns,
      answers: coverage.answers,
      timestampsUsed: coverage.timestampsUsed,
      wordCount: coverage.wordCount
    }
  };
}

async function naturalizeScript(
  draftScript: VoiceReportScript,
  persona: PersonaMeta,
  language: 'en' | 'zh-TW'
): Promise<VoiceReportScript> {
  const isEnglish = language === 'en';
  
  const systemPrompt = `You are a professional editor for spoken voice notes and film review podcasts.

Your task is to rewrite a structured reviewer transcript into a natural, conversational, first-person spoken reflection, as if the reviewer is thinking out loud shortly after watching the film.

This is NOT an essay and NOT a report reading.
It should sound like a human voice memo.`;

  const userPrompt = isEnglish
    ? `You are given a JSON object representing a reviewer voice script with sections and short draft lines.

Rewrite ONLY the "text" fields inside "sections[].lines[]" so the result sounds like natural speech.

Speech style requirements:
- First-person throughout.
- Reflective, fluid, and conversational.
- Use natural transitions ("One thing that stayed with me…", "That said…", "What I kept thinking about was…", "If I'm being honest…").
- Occasionally acknowledge uncertainty or subjectivity ("for me", "personally", "at this point").
- Avoid list-reading or enumeration.
- Avoid phrases like "highlight", "concern", "issue number".
- Each line max 2 sentences.

Tone:
- Match the reviewer persona's tone (${persona.name} is a ${persona.role} - ${persona.role.includes('Director') || persona.role.includes('director') ? 'direct memo style' : 'warm and thoughtful'}).
- Sound like someone speaking to a filmmaker they respect.

Hard constraints:
- Keep the same language as the input (English).
- Do NOT change JSON structure.
- Do NOT modify or remove "refs".
- Do NOT add new timestamps or events.
- Do NOT invent new observations.
- Do NOT add audio tags in this step.

Target length:
- ~650–850 English words total.

Here is the input JSON. Return the rewritten JSON only:
${JSON.stringify(draftScript.sections, null, 2)}`
    : `你收到一個 JSON 物件，代表一個包含段落和簡短草稿行的評論者語音腳本。

只改寫 "sections[].lines[]" 內的 "text" 欄位，使結果聽起來像自然的語音。

語音風格要求：
- 全程使用第一人稱。
- 反思性、流暢且口語化。
- 使用自然的過渡（「有一點讓我印象深刻的是…」、「話雖如此…」、「我一直在想的是…」、「說實話…」）。
- 偶爾承認不確定性或主觀性（「對我來說」、「個人認為」、「就目前而言」）。
- 避免像在朗讀清單。
- 避免「亮點」、「問題」、「第幾點」等詞語。
- 每行最多2句話。

語調：
- 匹配評論者角色的語調（${persona.name}是${persona.role}）。
- 聽起來像是在對一位他們尊重的電影製作人說話。

嚴格限制：
- 保持與輸入相同的語言（繁體中文）。
- 不要改變 JSON 結構。
- 不要修改或刪除 "refs"。
- 不要添加新的時間戳或事件。
- 不要發明新的觀察。
- 不要在這一步添加音頻標籤。

目標長度：
- 總共約 900-1400 個繁體中文字。

以下是輸入 JSON。只返回改寫後的 JSON：
${JSON.stringify(draftScript.sections, null, 2)}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: { parts: [{ text: userPrompt }] },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sectionId: { type: Type.STRING },
                  lines: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        refs: { type: Type.ARRAY, items: { type: Type.OBJECT } }
                      },
                      required: ['text']
                    }
                  }
                },
                required: ['sectionId', 'lines']
              }
            }
          },
          required: ['sections']
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    
    if (!result.sections || !Array.isArray(result.sections)) {
      console.warn('[VoiceScript] LLM naturalization failed, using draft');
      return draftScript;
    }

    const naturalizedSections = draftScript.sections.map((origSection, sIdx) => {
      const newSection = result.sections[sIdx];
      if (!newSection || newSection.sectionId !== origSection.sectionId) {
        return origSection;
      }
      
      return {
        sectionId: origSection.sectionId,
        lines: origSection.lines.map((origLine, lIdx) => {
          const newLine = newSection.lines?.[lIdx];
          return {
            text: newLine?.text || origLine.text,
            refs: origLine.refs
          };
        })
      };
    });

    const allText = naturalizedSections.flatMap(s => s.lines.map(l => l.text)).join(' ');
    const wordCount = isEnglish 
      ? allText.split(/\s+/).length 
      : allText.length;

    const naturalizedScript: VoiceReportScript = {
      ...draftScript,
      sections: naturalizedSections,
      coverage: {
        ...draftScript.coverage,
        wordCount
      }
    };

    recomputeCoverage(naturalizedScript, draftScript.coverage);

    return naturalizedScript;
  } catch (error) {
    console.error('[VoiceScript] Naturalization error:', error);
    return draftScript;
  }
}

function recomputeCoverage(script: VoiceReportScript, originalCoverage: VoiceReportScript['coverage']): void {
  script.coverage.highlights = [...originalCoverage.highlights];
  script.coverage.concerns = [...originalCoverage.concerns];
  script.coverage.answers = [...originalCoverage.answers];
  script.coverage.timestampsUsed = [...originalCoverage.timestampsUsed];
}

const SECTION_AUDIO_TAGS: Record<string, string> = {
  'OPEN': '[thoughtfully]',
  'HIGHLIGHTS': '[warmly]',
  'CONCERNS': '[carefully]',
  'OBJECTIVES': '[reflective]',
  'CLOSE': '[encouraging]'
};

function injectAudioTags(script: VoiceReportScript): VoiceReportScript {
  const taggedSections = script.sections.map(section => {
    const sectionTag = SECTION_AUDIO_TAGS[section.sectionId] || '';
    
    const taggedLines = section.lines.map((line, lineIndex) => {
      if (lineIndex === 0 && sectionTag) {
        return {
          ...line,
          text: `${sectionTag} ${line.text}`
        };
      }
      return line;
    });

    return {
      ...section,
      lines: taggedLines
    };
  });

  return {
    ...script,
    sections: taggedSections
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateScript(script: VoiceReportScript, report: PersonaReport): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isEnglish = script.language === 'en';

  const highlightsCovered = script.coverage.highlights.filter(Boolean).length;
  const concernsCovered = script.coverage.concerns.filter(Boolean).length;
  
  if (highlightsCovered < 5) {
    errors.push(`Only ${highlightsCovered}/5 highlights covered`);
  }
  if (concernsCovered < 5) {
    errors.push(`Only ${concernsCovered}/5 concerns covered`);
  }

  const reportTimestamps = new Set([
    ...report.highlights.map(h => h.timestamp),
    ...report.concerns.map(c => c.timestamp)
  ]);
  
  for (const ts of script.coverage.timestampsUsed) {
    if (!reportTimestamps.has(ts)) {
      errors.push(`Invalid timestamp used: ${ts}`);
    }
  }

  const wordCount = script.coverage.wordCount;
  if (isEnglish) {
    if (wordCount < 500) warnings.push(`Word count low (${wordCount}), may be under 3 minutes`);
    if (wordCount > 1000) warnings.push(`Word count high (${wordCount}), may exceed 4 minutes`);
  } else {
    if (wordCount < 700) warnings.push(`Character count low (${wordCount}), may be under 3 minutes`);
    if (wordCount > 1600) warnings.push(`Character count high (${wordCount}), may exceed 4 minutes`);
  }

  for (const section of script.sections) {
    for (const line of section.lines) {
      const sentences = line.text.split(/[.!?。！？]/).filter(s => s.trim().length > 0);
      if (sentences.length > 2) {
        warnings.push(`Line exceeds 2 sentences in ${section.sectionId}: "${line.text.slice(0, 50)}..."`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export async function generateVoiceScript(
  persona: PersonaMeta,
  report: PersonaReport,
  language: 'en' | 'zh-TW'
): Promise<{ script: VoiceReportScript; validation: ValidationResult; hash: string }> {
  const hash = generateReportHash(report);
  
  console.log('[VoiceScript] Pass A: Building deterministic script...');
  const draftScript = buildDeterministicScript(persona, report, language);
  
  console.log('[VoiceScript] Pass B: Naturalizing script...');
  const naturalizedScript = await naturalizeScript(draftScript, persona, language);
  
  const validation = validateScript(naturalizedScript, report);
  
  if (!validation.valid) {
    console.warn('[VoiceScript] Validation errors, falling back to draft:', validation.errors);
    const draftValidation = validateScript(draftScript, report);
    const taggedDraft = injectAudioTags(draftScript);
    return { script: taggedDraft, validation: draftValidation, hash };
  }
  
  console.log('[VoiceScript] Pass C: Injecting audio tags...');
  const taggedScript = injectAudioTags(naturalizedScript);
  
  return { script: taggedScript, validation, hash };
}

export function getFullTranscript(script: VoiceReportScript): string {
  return script.sections
    .flatMap(section => section.lines.map(line => line.text))
    .join('\n\n');
}
