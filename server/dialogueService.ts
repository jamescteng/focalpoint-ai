import { GoogleGenAI } from "@google/genai";
import { DialogueScript, Report, Session, DialogueJob, dialogueJobs, sessions, reports } from '../shared/schema';
import { getPersonaById } from './personas';
import { getVoiceId } from './elevenLabsService';
import { ObjectStorageService } from './replit_integrations/object_storage';
import { db } from './db';
import { eq } from 'drizzle-orm';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

const RUNTIME_TARGET_SEC = 300;

const AUDIO_TAGS_EN = {
  agreement: 'warmly',
  disagreement: 'thoughtfully',
  reflection: 'reflective',
  emphasis: 'seriously',
  transition: 'matter-of-fact'
};

const AUDIO_TAGS_ZH = {
  agreement: '溫和地',
  disagreement: '認真地',
  reflection: '思考中',
  emphasis: '認真地',
  transition: '平實地'
};

export interface DialogueGenerationResult {
  success: boolean;
  jobId?: number;
  error?: string;
}

export interface DialogueJobStatus {
  status: 'queued' | 'scripting' | 'rendering' | 'complete' | 'failed';
  progress?: string;
  script?: DialogueScript;
  audioUrl?: string;
  error?: string;
}

function getAudioTags(language: 'en' | 'zh-TW') {
  return language === 'zh-TW' ? AUDIO_TAGS_ZH : AUDIO_TAGS_EN;
}

const OPENING_STYLES_EN = [
  'Start with a casual observation about a specific scene that stood out',
  'Begin with one reviewer expressing initial surprise about something unexpected',
  'Open with a reflective moment about the emotional impact of the film',
  'Start mid-thought as if continuing a hallway conversation after the screening',
  'Begin with a direct question from one reviewer to the other about their reaction'
];

const OPENING_STYLES_ZH = [
  '以對某個特別場景的隨意觀察開始',
  '以一位評論者對某個出乎意料之處表達驚訝開始',
  '以對影片情感衝擊的反思開始',
  '像是在放映後走廊對話的延續，從話題中間開始',
  '以一位評論者直接問另一位的反應開始'
];

const CLOSING_STYLES_EN = [
  'End with thoughts on who would most enjoy this film',
  'Close with a brief mention of what lingers after watching',
  'Finish with contrasting final takeaways from each reviewer',
  'End with speculation about the filmmaker\'s intentions',
  'Close with a quick rating or recommendation style'
];

const CLOSING_STYLES_ZH = [
  '以誰最適合看這部片的想法結束',
  '以觀影後最深刻的餘韻結束',
  '以兩位評論者對比的最終收穫結束',
  '以對導演意圖的推測結束',
  '以簡短的評分或推薦方式結束'
];

function buildDialoguePrompt(
  session: Session,
  reportA: Report,
  reportB: Report,
  personaAConfig: { name: string; role: string },
  personaBConfig: { name: string; role: string },
  language: 'en' | 'zh-TW'
): string {
  const langName = language === 'zh-TW' ? '繁體中文（台灣口語）' : 'English';
  
  const openingIdx = Math.floor(Math.random() * OPENING_STYLES_EN.length);
  const closingIdx = Math.floor(Math.random() * CLOSING_STYLES_EN.length);
  const openingStyle = language === 'zh-TW' ? OPENING_STYLES_ZH[openingIdx] : OPENING_STYLES_EN[openingIdx];
  const closingStyle = language === 'zh-TW' ? CLOSING_STYLES_ZH[closingIdx] : CLOSING_STYLES_EN[closingIdx];
  const firstSpeaker = Math.random() > 0.5 ? personaAConfig.name : personaBConfig.name;
  
  const enPrompt = `
You are a professional podcast script writer. Transform these two film reviewer reports into a natural, engaging two-person conversation.

PARTICIPANTS:
- ${personaAConfig.name} (${personaAConfig.role})
- ${personaBConfig.name} (${personaBConfig.role})

FILM: "${session.title}"
SYNOPSIS: ${session.synopsis}

=== REVIEWER A (${personaAConfig.name}) REPORT ===
Executive Summary: ${reportA.executiveSummary}

Highlights:
${(reportA.highlights as any[]).map((h, i) => `${i + 1}. [${h.timestamp || 'N/A'}] ${h.title}: ${h.description}`).join('\n')}

Concerns:
${(reportA.concerns as any[]).map((c, i) => `${i + 1}. [${c.timestamp || 'N/A'}] ${c.issue} (Severity: ${c.severity}/5): ${c.impact}`).join('\n')}

=== REVIEWER B (${personaBConfig.name}) REPORT ===
Executive Summary: ${reportB.executiveSummary}

Highlights:
${(reportB.highlights as any[]).map((h, i) => `${i + 1}. [${h.timestamp || 'N/A'}] ${h.title}: ${h.description}`).join('\n')}

Concerns:
${(reportB.concerns as any[]).map((c, i) => `${i + 1}. [${c.timestamp || 'N/A'}] ${c.issue} (Severity: ${c.severity}/5): ${c.impact}`).join('\n')}

=== INSTRUCTIONS ===

Generate a podcast-style dialogue script (target runtime: ~5 minutes, ~${RUNTIME_TARGET_SEC} seconds).

HARD CONSTRAINTS:
1. Must feel like a REAL DISCUSSION, not reading bullet points
2. Timestamps must NEVER start a sentence (embed mid-sentence: "That moment around the 2-minute mark...")
3. NO invented scenes, events, or timestamps not in the reports
4. Must cover ALL 10 highlights and ALL 10 concerns across both reviewers
5. Keep each turn SHORT (1-3 sentences max)
6. Allow natural disagreement and contrast, but remain constructive
7. Include callbacks to earlier points ("I agree with what you said about...")
8. Natural conversation flow with reactions ("Interesting point...", "I see it differently...")

STRUCTURE:
1. Opening: ${openingStyle}. ${firstSpeaker} speaks first.
2. Body: Discuss highlights and concerns naturally, weaving between reviewers
3. Closing: ${closingStyle}

OUTPUT FORMAT (JSON):
{
  "turns": [
    {
      "speakerPersonaId": "${reportA.personaId}",
      "text": "The dialogue line here",
      "refs": [
        {
          "personaId": "${reportA.personaId}",
          "type": "highlight",
          "index": 0
        }
      ],
      "audioTag": "reflective"
    }
  ],
  "coverage": {
    "byPersona": {
      "${reportA.personaId}": {
        "highlights": [true, true, true, true, true],
        "concerns": [true, true, true, true, true],
        "answers": []
      },
      "${reportB.personaId}": {
        "highlights": [true, true, true, true, true],
        "concerns": [true, true, true, true, true],
        "answers": []
      }
    }
  }
}

Audio tags (use sparingly, ~1 per 3-4 turns):
- "reflective" - for thoughtful observations
- "warmly" - for agreement or praise
- "thoughtfully" - for gentle disagreement
- "seriously" - for important concerns
- "matter-of-fact" - for transitions

Return ONLY valid JSON with no additional text.
`;

  const zhPrompt = `
你是一位專業的 Podcast 腳本寫手。請將這兩位影評人的報告轉化為自然、有吸引力的雙人對談。

參與者：
- ${personaAConfig.name}（${personaAConfig.role}）
- ${personaBConfig.name}（${personaBConfig.role}）

影片：「${session.title}」
簡介：${session.synopsis}

=== 評論者 A（${personaAConfig.name}）報告 ===
執行摘要：${reportA.executiveSummary}

亮點：
${(reportA.highlights as any[]).map((h, i) => `${i + 1}. [${h.timestamp || '無'}] ${h.title}：${h.description}`).join('\n')}

疑慮：
${(reportA.concerns as any[]).map((c, i) => `${i + 1}. [${c.timestamp || '無'}] ${c.issue}（嚴重度：${c.severity}/5）：${c.impact}`).join('\n')}

=== 評論者 B（${personaBConfig.name}）報告 ===
執行摘要：${reportB.executiveSummary}

亮點：
${(reportB.highlights as any[]).map((h, i) => `${i + 1}. [${h.timestamp || '無'}] ${h.title}：${h.description}`).join('\n')}

疑慮：
${(reportB.concerns as any[]).map((c, i) => `${i + 1}. [${c.timestamp || '無'}] ${c.issue}（嚴重度：${c.severity}/5）：${c.impact}`).join('\n')}

=== 指示 ===

生成 Podcast 風格對話腳本（目標時長：約 5 分鐘，約 ${RUNTIME_TARGET_SEC} 秒）。

嚴格規則：
1. 必須像真正的對話，不是念報告
2. 時間戳絕對不能放在句首（要嵌入句中：「大概在兩分鐘左右那段⋯⋯」）
3. 不可編造報告中沒有的場景、事件或時間戳
4. 必須涵蓋兩位評論者的全部 10 個亮點和 10 個疑慮
5. 每個發言要簡短（最多 1-3 句）
6. 允許自然的意見分歧，但保持建設性
7. 包含對前面觀點的回應（「我同意你剛才說的⋯⋯」）
8. 自然的對話流程，有反應（「有意思⋯⋯」、「我的看法不太一樣⋯⋯」）
9. 使用台灣口語中文，不是中國用語

結構：
1. 開場：${openingStyle}。由 ${firstSpeaker} 先開口。
2. 主體：自然地討論亮點和疑慮，在兩位評論者間交織
3. 結尾：${closingStyle}

輸出格式（JSON）：
{
  "turns": [
    {
      "speakerPersonaId": "${reportA.personaId}",
      "text": "對話內容",
      "refs": [
        {
          "personaId": "${reportA.personaId}",
          "type": "highlight",
          "index": 0
        }
      ],
      "audioTag": "思考中"
    }
  ],
  "coverage": {
    "byPersona": {
      "${reportA.personaId}": {
        "highlights": [true, true, true, true, true],
        "concerns": [true, true, true, true, true],
        "answers": []
      },
      "${reportB.personaId}": {
        "highlights": [true, true, true, true, true],
        "concerns": [true, true, true, true, true],
        "answers": []
      }
    }
  }
}

音頻標記（少用，約每 3-4 個發言一個）：
- "思考中" - 深思的觀察
- "溫和地" - 同意或稱讚
- "認真地" - 溫和的不同意見
- "平實地" - 轉場

只回傳有效的 JSON，不要有其他文字。
`;

  return language === 'zh-TW' ? zhPrompt : enPrompt;
}

async function generateDialogueScript(
  session: Session,
  reportA: Report,
  reportB: Report,
  language: 'en' | 'zh-TW'
): Promise<DialogueScript> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const personaAConfig = getPersonaById(reportA.personaId);
  const personaBConfig = getPersonaById(reportB.personaId);
  
  if (!personaAConfig || !personaBConfig) {
    throw new Error('Invalid persona configuration');
  }

  const aliasA = session.personaAliases?.find(a => a.personaId === reportA.personaId);
  const aliasB = session.personaAliases?.find(a => a.personaId === reportB.personaId);
  
  const nameA = aliasA?.name || personaAConfig.name;
  const roleA = aliasA?.role || personaAConfig.role;
  const nameB = aliasB?.name || personaBConfig.name;
  const roleB = aliasB?.role || personaBConfig.role;

  const prompt = buildDialoguePrompt(
    session,
    reportA,
    reportB,
    { name: nameA, role: roleA },
    { name: nameB, role: roleB },
    language
  );

  const genAI = new GoogleGenAI({ apiKey });
  
  const response = await genAI.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.8
    }
  });

  const text = response.text || '';
  const parsed = JSON.parse(text);

  const dialogueScript: DialogueScript = {
    version: "1.0",
    sessionId: session.id,
    language,
    participants: [
      {
        personaId: reportA.personaId,
        displayName: nameA,
        role: roleA,
        voiceId: getVoiceId(reportA.personaId, language)
      },
      {
        personaId: reportB.personaId,
        displayName: nameB,
        role: roleB,
        voiceId: getVoiceId(reportB.personaId, language)
      }
    ],
    runtimeTargetSec: RUNTIME_TARGET_SEC,
    turns: parsed.turns,
    coverage: parsed.coverage
  };

  return dialogueScript;
}

function getDialogueModelId(language: 'en' | 'zh-TW'): string {
  return language === 'zh-TW' ? 'eleven_multilingual_v2' : 'eleven_v3';
}

async function textToDialogue(
  script: DialogueScript
): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const voiceMap = new Map(
    script.participants.map(p => [p.personaId, p.voiceId])
  );

  const modelId = getDialogueModelId(script.language);
  const useAudioTags = modelId === 'eleven_v3';

  const dialogueInputs = script.turns.map(turn => {
    let text = turn.text;
    if (useAudioTags && turn.audioTag) {
      text = `[${turn.audioTag}] ${text}`;
    }
    return {
      text,
      voice_id: voiceMap.get(turn.speakerPersonaId) || script.participants[0].voiceId
    };
  });

  console.log(`[Dialogue] Generating audio with ${dialogueInputs.length} turns, model: ${modelId}, audioTags: ${useAudioTags}`);

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-dialogue`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      inputs: dialogueInputs,
      model_id: modelId
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs Dialogue API error: ${response.status} - ${errorText}`);
  }

  return response.arrayBuffer();
}

export async function createDialogueJob(
  sessionId: number,
  personaA: string,
  personaB: string,
  language: 'en' | 'zh-TW'
): Promise<DialogueGenerationResult> {
  try {
    const [job] = await db.insert(dialogueJobs).values({
      sessionId,
      personaA,
      personaB,
      language,
      status: 'queued',
      attemptCount: 0
    }).returning();

    processDialogueJob(job.id).catch(err => {
      console.error(`[Dialogue] Background job ${job.id} failed:`, err);
    });

    return { success: true, jobId: job.id };
  } catch (error) {
    console.error('[Dialogue] Failed to create job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function processDialogueJob(jobId: number): Promise<void> {
  const [job] = await db.select().from(dialogueJobs).where(eq(dialogueJobs.id, jobId));
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  try {
    await db.update(dialogueJobs)
      .set({ status: 'scripting', attemptCount: job.attemptCount + 1, updatedAt: new Date() })
      .where(eq(dialogueJobs.id, jobId));
    
    const [session] = await db.select().from(sessions).where(eq(sessions.id, job.sessionId));
    if (!session) {
      throw new Error('Session not found');
    }

    const allReports = await db.select().from(reports).where(eq(reports.sessionId, job.sessionId));
    const reportA = allReports.find(r => r.personaId === job.personaA);
    const reportB = allReports.find(r => r.personaId === job.personaB);

    if (!reportA || !reportB) {
      throw new Error('Reports not found for selected personas');
    }

    console.log(`[Dialogue] Generating script for job ${jobId}`);
    const script = await generateDialogueScript(
      session,
      reportA,
      reportB,
      job.language as 'en' | 'zh-TW'
    );

    await db.update(dialogueJobs)
      .set({ status: 'rendering', scriptJson: script, updatedAt: new Date() })
      .where(eq(dialogueJobs.id, jobId));

    console.log(`[Dialogue] Rendering audio for job ${jobId}`);
    const audioBuffer = await textToDialogue(script);

    const objectStorage = new ObjectStorageService();
    const privateDir = objectStorage.getPrivateObjectDir();
    const objectPath = `${privateDir}/dialogues/${job.sessionId}/${job.personaA}_${job.personaB}_${Date.now()}.mp3`;
    
    const uploadUrl = await objectStorage.getObjectEntityUploadURL();
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: audioBuffer,
      headers: {
        'Content-Type': 'audio/mpeg'
      }
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload audio: ${uploadResponse.status}`);
    }

    const normalizedPath = objectStorage.normalizeObjectEntityPath(uploadUrl);

    await db.update(dialogueJobs)
      .set({ 
        status: 'complete', 
        audioStorageKey: normalizedPath,
        updatedAt: new Date() 
      })
      .where(eq(dialogueJobs.id, jobId));

    console.log(`[Dialogue] Job ${jobId} complete, audio at ${normalizedPath}`);

  } catch (error) {
    console.error(`[Dialogue] Job ${jobId} failed:`, error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (job.attemptCount < 1) {
      console.log(`[Dialogue] Retrying job ${jobId}`);
      await db.update(dialogueJobs)
        .set({ status: 'queued', lastError: errorMessage, updatedAt: new Date() })
        .where(eq(dialogueJobs.id, jobId));
      
      setTimeout(() => processDialogueJob(jobId), 2000);
    } else {
      await db.update(dialogueJobs)
        .set({ status: 'failed', lastError: errorMessage, updatedAt: new Date() })
        .where(eq(dialogueJobs.id, jobId));
    }
  }
}

export async function getDialogueJobStatus(jobId: number): Promise<DialogueJobStatus | null> {
  const [job] = await db.select().from(dialogueJobs).where(eq(dialogueJobs.id, jobId));
  
  if (!job) {
    return null;
  }

  const statusMap: Record<string, DialogueJobStatus['status']> = {
    'queued': 'queued',
    'scripting': 'scripting',
    'rendering': 'rendering',
    'complete': 'complete',
    'failed': 'failed'
  };

  return {
    status: statusMap[job.status] || 'queued',
    script: job.scriptJson || undefined,
    audioUrl: job.audioStorageKey || undefined,
    error: job.lastError || undefined
  };
}

export async function getDialogueJobResult(jobId: number): Promise<{
  script: DialogueScript;
  audioUrl: string;
  transcript: string;
} | null> {
  const [job] = await db.select().from(dialogueJobs).where(eq(dialogueJobs.id, jobId));
  
  if (!job || job.status !== 'complete' || !job.scriptJson || !job.audioStorageKey) {
    return null;
  }

  const transcript = job.scriptJson.turns
    .map(turn => {
      const participant = job.scriptJson!.participants.find(p => p.personaId === turn.speakerPersonaId);
      const name = participant?.displayName || turn.speakerPersonaId;
      return `${name}: ${turn.text}`;
    })
    .join('\n\n');

  return {
    script: job.scriptJson,
    audioUrl: job.audioStorageKey,
    transcript
  };
}

export async function getSessionDialogues(sessionId: number): Promise<DialogueJob[]> {
  return db.select().from(dialogueJobs).where(eq(dialogueJobs.sessionId, sessionId));
}
