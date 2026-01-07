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

interface PersonalizedLines {
  openingLines: string[];
  closingLines: string[];
}

async function generatePersonalizedOpenClose(
  persona: PersonaMeta,
  report: PersonaReport,
  language: 'en' | 'zh-TW'
): Promise<PersonalizedLines> {
  const isEnglish = language === 'en';
  
  const systemPrompt = isEnglish
    ? `You generate short, natural voice memo openings and closings for film reviewers.
Each reviewer has a distinct personality and professional perspective.
Write in first-person, spoken style - not formal or written.`
    : `你為影評者生成簡短、自然的語音筆記開場白和結語。
每位評論者都有獨特的個性和專業視角。
請用第一人稱、口語風格撰寫——不要正式或書面。`;

  const userPrompt = isEnglish
    ? `Generate personalized opening and closing lines for this reviewer's voice notes.

Reviewer: ${persona.name}
Role: ${persona.role}
Film Summary: ${report.executive_summary.slice(0, 300)}

Requirements:
- Opening: 2 lines total. First line introduces who they are in their unique voice. Second line sets up what they'll discuss.
- Closing: 2 lines total. First line gives their overall take fitting their perspective. Second line is a brief sign-off.
- Match the reviewer's professional perspective (e.g., acquisitions director thinks about marketability, cultural editor about artistic merit)
- Sound natural and spoken, not scripted
- Keep each line under 25 words
- Do NOT use generic phrases like "I just finished watching" or "Keep pushing forward"

Return JSON with openingLines (array of 2 strings) and closingLines (array of 2 strings).`
    : `為這位評論者的語音筆記生成個人化的開場白和結語。

評論者：${persona.name}
角色：${persona.role}
影片摘要：${report.executive_summary.slice(0, 300)}

要求：
- 開場白：共2行。第一行用他們獨特的聲音介紹自己。第二行說明將討論什麼。
- 結語：共2行。第一行給出符合他們視角的整體評價。第二行是簡短的結尾語。
- 符合評論者的專業視角（例如：收購總監關注市場性，文化編輯關注藝術價值）
- 聽起來自然、口語化，不像念稿
- 每行不超過40個字
- 不要使用老套的句子如「我剛看完這部影片」或「繼續努力」

回傳 JSON，包含 openingLines（2個字串的陣列）和 closingLines（2個字串的陣列）。`;

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
            openingLines: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            closingLines: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ['openingLines', 'closingLines']
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    
    if (result.openingLines?.length >= 2 && result.closingLines?.length >= 2) {
      console.log('[VoiceScript] Generated personalized open/close for', persona.name);
      return {
        openingLines: result.openingLines.slice(0, 2),
        closingLines: result.closingLines.slice(0, 2)
      };
    }
  } catch (error) {
    console.error('[VoiceScript] Failed to generate personalized lines:', error);
  }

  const fallbackOpen = isEnglish
    ? [`This is ${persona.name}, ${persona.role}.`, `Here's what stood out to me from this screening.`]
    : [`我是${persona.name}，${persona.role}。`, `以下是這次放映中讓我印象深刻的地方。`];
  
  const fallbackClose = isEnglish
    ? [`That's my take on this one.`, `Looking forward to seeing where this goes.`]
    : [`這是我對這部作品的看法。`, `期待看到後續的發展。`];

  return { openingLines: fallbackOpen, closingLines: fallbackClose };
}

function buildDeterministicScript(
  persona: PersonaMeta,
  report: PersonaReport,
  language: 'en' | 'zh-TW',
  personalizedLines?: PersonalizedLines
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

  const openingLines = personalizedLines?.openingLines || (isEnglish
    ? [`This is ${persona.name}, ${persona.role}.`, `Here's what stood out to me from this screening.`]
    : [`我是${persona.name}，${persona.role}。`, `以下是這次放映中讓我印象深刻的地方。`]);

  sections.push({
    sectionId: 'OPEN',
    lines: [
      { text: openingLines[0], refs: [] },
      { text: openingLines[1], refs: [{ type: 'summary' }] }
    ]
  });

  const highlightLines: VoiceReportScript['sections'][0]['lines'] = [];
  highlightLines.push({
    text: isEnglish
      ? `A few moments kept resurfacing for me after watching.`
      : `看完之後，有幾個畫面一直在我腦海裡浮現。`,
    refs: []
  });
  report.highlights.slice(0, 5).forEach((h, i) => {
    coverage.highlights[i] = true;
    if (h.timestamp) coverage.timestampsUsed.push(h.timestamp);
    
    highlightLines.push({
      text: isEnglish 
        ? `${h.summary}, around ${h.timestamp}. ${h.why_it_works}`
        : `${h.summary}，大約在 ${h.timestamp}。${h.why_it_works}`,
      refs: [{ type: 'highlight', index: i, timestamp: h.timestamp, seconds: h.seconds }]
    });
  });
  sections.push({ sectionId: 'HIGHLIGHTS', lines: highlightLines });

  const concernLines: VoiceReportScript['sections'][0]['lines'] = [];
  concernLines.push({
    text: isEnglish
      ? `There were also a couple of places where I felt myself pull back.`
      : `也有幾個地方讓我有些出戲。`,
    refs: []
  });
  report.concerns.slice(0, 5).forEach((c, i) => {
    coverage.concerns[i] = true;
    if (c.timestamp) coverage.timestampsUsed.push(c.timestamp);
    
    concernLines.push({
      text: isEnglish
        ? `${c.issue}, around ${c.timestamp}. ${c.impact} Consider ${c.suggested_fix.toLowerCase()}.`
        : `${c.issue}，大約在 ${c.timestamp}。${c.impact} 建議${c.suggested_fix}。`,
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

  const closingLines = personalizedLines?.closingLines || (isEnglish
    ? [`That's my take on this one.`, `Looking forward to seeing where this goes.`]
    : [`這是我對這部作品的看法。`, `期待看到後續的發展。`]);

  sections.push({
    sectionId: 'CLOSE',
    lines: [
      { text: closingLines[0], refs: [{ type: 'summary' }] },
      { text: closingLines[1], refs: [] }
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
  
  const systemPrompt = isEnglish
    ? `You are rewriting professional film notes into a spoken, first-person voice memo.

This must sound like a real human thinking out loud after a screening.
Not a report. Not a lecture. Not written notes read aloud.

Imagine the reviewer is alone, recording a private voice memo to themselves.`
    : `你是一位專門編修「口語影評語音筆記」的編輯。

你的任務是把結構化、偏書面或報告式的影評內容，
改寫成「台灣口語中文」的第一人稱語音反思，
聽起來像是真人剛看完電影後，對自己或對創作者說的心裡話。

這不是論文、不是報告朗讀，也不是正式簡報。
而是一段自然、思考中的口語回顧。`;

  const userPrompt = isEnglish
    ? `Rewrite ONLY the "text" fields inside "sections[].lines[]" to sound like natural spoken reflection.

MANDATORY RULES:
- Do NOT start any sentence with a timestamp (e.g. "At 02:13", "Around 12:55").
- If a timestamp is mentioned, it must appear LATER in the sentence, or after an initial clause.
- Do NOT use report verbs like "establishes", "demonstrates", "undermines", "reduces credibility".
- Replace them with experiential language ("what this did for me…", "this is where I felt…", "it started to feel…").

Speech requirements:
- First-person, reflective, slightly imperfect.
- Include metacognition: noticing, remembering, reacting.
- Vary sentence openings ("One thing that stayed with me…", "What surprised me was…", "By the time we get to…").
- Allow mild subjectivity ("for me", "personally", "I kept feeling like…").
- Each line max 2 sentences.

Tone:
- Still professional.
- Still intelligent.
- But spoken, not written.
- Sound like someone speaking to a filmmaker they respect.

Hard constraints:
- Keep the same language as input (English).
- Do NOT change JSON structure.
- Do NOT modify or remove refs.
- Do NOT add new events or timestamps.
- Do NOT summarize multiple highlights into one.

Here is the input JSON. Return rewritten JSON only:
${JSON.stringify(draftScript.sections, null, 2)}`
    : `以下是一個 JSON 物件，代表一位影評者的語音腳本草稿。
目前的文字仍偏書面、偏報告感。

請只改寫 sections[].lines[].text 這些欄位，
讓整體聽起來像是「台灣人用中文講話」的自然語音反思。

【強制規則（非常重要）】

1. 不可以用時間戳開頭一句話
   ❌「在 02:13，Mary 開始⋯⋯」
   ✅「有一段我特別記得，大概在 02:13 左右⋯⋯」

2. 不要使用書面或評論腔動詞，例如：
   ❌「建立了」、「展現了」、「削弱了可信度」、「加強了敘事張力」
   請改成觀看經驗語言，例如：
   ✅「我那時候真的感覺到⋯⋯」
   ✅「這一段讓我比較有感覺的是⋯⋯」
   ✅「我開始有點出戲的是⋯⋯」

3. 必須是第一人稱，並且帶有思考感
   請多用：
   「我覺得」、「我當下的感覺是」、「我一直在想」、「對我來說」

4. 每一行最多兩句話
   但語氣可以自然、有停頓感，不需要對稱或工整。

5. 嚴禁列點、編號、或像在唸清單
   不可以出現「第一個／第二個／再來」這種結構。

【語氣與風格】

- 使用台灣常見的口語中文（不是中國用語、不是書面文）
- 專業，但不正式
- 像是私下錄音，不像對外發表
- 可以出現輕微猶豫、回想、轉折

【時間戳使用方式】

- 時間戳只能自然地嵌在句子中
- 可以用「差不多在⋯⋯左右」、「那一段大概在⋯⋯」
- 不要頻繁重複，每一段不一定都要有

【硬性限制】

- 必須維持原本的 JSON 結構
- 不可以新增、刪除或修改 refs
- 不可以新增新的劇情、事件或時間
- 不可以改變 sections、欄位名稱或順序
- 只回傳 JSON，不要有任何額外說明文字

【長度目標】

- 全文約 900–1400 個繁體中文字
- 聽起來約 3–4 分鐘語音

以下是輸入 JSON，請只回傳改寫後的 JSON：
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
  
  console.log('[VoiceScript] Generating personalized opening/closing...');
  const personalizedLines = await generatePersonalizedOpenClose(persona, report, language);
  
  console.log('[VoiceScript] Pass A: Building deterministic script...');
  const draftScript = buildDeterministicScript(persona, report, language, personalizedLines);
  
  console.log('[VoiceScript] Pass B: Naturalizing script...');
  const naturalizedScript = await naturalizeScript(draftScript, persona, language);
  
  const validation = validateScript(naturalizedScript, report);
  
  if (!validation.valid) {
    console.warn('[VoiceScript] Validation errors, falling back to draft:', validation.errors);
    const draftValidation = validateScript(draftScript, report);
    return { script: draftScript, validation: draftValidation, hash };
  }
  
  return { script: naturalizedScript, validation, hash };
}

export function getFullTranscript(script: VoiceReportScript): string {
  return script.sections
    .flatMap(section => section.lines.map(line => line.text))
    .join('\n\n');
}

const SECTION_AUDIO_TAGS: Record<string, { en: string; 'zh-TW': string }> = {
  'OPEN': { en: '[reflective]', 'zh-TW': '[思考中]' },
  'HIGHLIGHTS': { en: '[warmly]', 'zh-TW': '[溫和地]' },
  'CONCERNS': { en: '[thoughtfully]', 'zh-TW': '[認真地]' },
  'OBJECTIVES': { en: '[matter-of-fact]', 'zh-TW': '[平實地]' },
  'CLOSE': { en: '[encouraging]', 'zh-TW': '[鼓勵地]' }
};

function injectAudioTags(script: VoiceReportScript): VoiceReportScript {
  const language = script.language;
  
  const taggedSections = script.sections.map(section => {
    const tagMapping = SECTION_AUDIO_TAGS[section.sectionId];
    const sectionTag = tagMapping ? tagMapping[language] : '';
    
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

export function getAudioText(script: VoiceReportScript): string {
  const taggedScript = injectAudioTags(script);
  return taggedScript.sections
    .flatMap(section => section.lines.map(line => line.text))
    .join(' ');
}
