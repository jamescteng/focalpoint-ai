import { VoiceReportScript } from '../shared/schema';
import { ObjectStorageService } from './replit_integrations/object_storage';
import { getAudioText } from './voiceScriptService';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

const VOICE_MAPPINGS: Record<string, { en: string; 'zh-TW': string }> = {
  acquisitions_director: {
    en: 'EXAVITQu4vr4xnSDxMaL',
    'zh-TW': 'EXAVITQu4vr4xnSDxMaL'
  },
  cultural_editor: {
    en: 'pFZP5JQG7iQjIQuC4Bku',
    'zh-TW': 'pFZP5JQG7iQjIQuC4Bku'
  },
  mass_audience_viewer: {
    en: 'TX3LPaxmHKxFdv7VOQHJ',
    'zh-TW': 'TX3LPaxmHKxFdv7VOQHJ'
  },
  social_impact_viewer: {
    en: 'XB0fDUnXU5powFXDhCwa',
    'zh-TW': 'XB0fDUnXU5powFXDhCwa'
  }
};

export interface AudioGenerationResult {
  success: boolean;
  audioUrl?: string;
  error?: string;
  languageSupported: boolean;
}

export function getVoiceId(personaId: string, language: 'en' | 'zh-TW'): string {
  const mapping = VOICE_MAPPINGS[personaId];
  if (!mapping) {
    return VOICE_MAPPINGS.acquisitions_director[language];
  }
  return mapping[language];
}

export function isLanguageSupported(_personaId: string, _language: 'en' | 'zh-TW'): boolean {
  return true;
}

function getModelId(language: 'en' | 'zh-TW'): string {
  return language === 'zh-TW' ? 'eleven_multilingual_v2' : 'eleven_v3';
}

async function textToSpeech(text: string, voiceId: string, language: 'en' | 'zh-TW'): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const modelId = getModelId(language);
  const stability = modelId === 'eleven_v3' ? 0.0 : 0.5;

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: 0.65
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

  try {
    const fullText = getAudioText(script);

    const modelId = getModelId(language);
    console.log(`[ElevenLabs] Generating audio for ${personaId}, ${fullText.length} chars, model: ${modelId}`);
    
    const audioBuffer = await textToSpeech(fullText, voiceId, language);
    
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
