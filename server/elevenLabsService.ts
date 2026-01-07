import { VoiceReportScript } from '../shared/schema';
import { ObjectStorageService } from './replit_integrations/object_storage';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

const VOICE_MAPPINGS: Record<string, { en: string; 'zh-TW': string | null }> = {
  acquisitions_director: {
    en: 'EXAVITQu4vr4xnSDxMaL',
    'zh-TW': null
  },
  cultural_editor: {
    en: 'pFZP5JQG7iQjIQuC4Bku',
    'zh-TW': null
  },
  mass_audience_viewer: {
    en: 'TX3LPaxmHKxFdv7VOQHJ',
    'zh-TW': null
  },
  social_impact_viewer: {
    en: 'XB0fDUnXU5powFXDhCwa',
    'zh-TW': null
  }
};

export interface AudioGenerationResult {
  success: boolean;
  audioUrl?: string;
  error?: string;
  languageSupported: boolean;
}

export function getVoiceId(personaId: string, language: 'en' | 'zh-TW'): string | null {
  const mapping = VOICE_MAPPINGS[personaId];
  if (!mapping) {
    return VOICE_MAPPINGS.acquisitions_director.en;
  }
  return mapping[language];
}

export function isLanguageSupported(personaId: string, language: 'en' | 'zh-TW'): boolean {
  const voiceId = getVoiceId(personaId, language);
  return voiceId !== null;
}

async function textToSpeech(text: string, voiceId: string): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  return response.arrayBuffer();
}

export async function generateAudio(
  script: VoiceReportScript,
  sessionId: number,
  personaId: string,
  reportHash: string
): Promise<AudioGenerationResult> {
  const language = script.language;
  const voiceId = getVoiceId(personaId, language);

  if (!voiceId) {
    return {
      success: false,
      error: `Voice not available for ${language}`,
      languageSupported: false
    };
  }

  try {
    const fullText = script.sections
      .flatMap(section => section.lines.map(line => line.text))
      .join(' ');

    console.log(`[ElevenLabs] Generating audio for ${personaId}, ${fullText.length} chars`);
    
    const audioBuffer = await textToSpeech(fullText, voiceId);
    
    const objectStorage = new ObjectStorageService();
    const privateDir = objectStorage.getPrivateObjectDir();
    const objectPath = `${privateDir}/voice-notes/${sessionId}/${personaId}_${reportHash}.mp3`;
    
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

    console.log(`[ElevenLabs] Audio stored at ${normalizedPath}`);

    return {
      success: true,
      audioUrl: normalizedPath,
      languageSupported: true
    };
  } catch (error) {
    console.error('[ElevenLabs] Audio generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      languageSupported: true
    };
  }
}

export async function checkApiKey(): Promise<boolean> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return false;

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/user`, {
      headers: {
        'xi-api-key': apiKey
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}
