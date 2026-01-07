import React, { useState, useRef, useEffect } from 'react';

interface VoicePlayerProps {
  sessionId: number;
  personaId: string;
  personaName: string;
  language: 'en' | 'zh-TW';
}

type PlayerState = 'idle' | 'generating_script' | 'generating_audio' | 'ready' | 'error';

export const VoicePlayer: React.FC<VoicePlayerProps> = ({
  sessionId,
  personaId,
  personaName,
  language
}) => {
  const [state, setState] = useState<PlayerState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languageSupported, setLanguageSupported] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  const isEnglish = language === 'en';
  const buttonLabel = isEnglish ? 'Listen to reviewer notes' : '收聽影評筆記';
  const generatingScriptLabel = isEnglish ? 'Generating script...' : '正在生成腳本...';
  const generatingAudioLabel = isEnglish ? 'Generating audio...' : '正在生成音頻...';
  const playLabel = isEnglish ? 'Play' : '播放';
  const pauseLabel = isEnglish ? 'Pause' : '暫停';
  const showTranscriptLabel = isEnglish ? 'Show transcript' : '顯示文字稿';
  const hideTranscriptLabel = isEnglish ? 'Hide transcript' : '隱藏文字稿';
  const voiceUnavailableLabel = isEnglish 
    ? 'Voice unavailable for this language' 
    : '此語言暫不支援語音';

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => setIsPlaying(false);
    }
  }, [audioUrl]);

  useEffect(() => {
    setState('idle');
    setAudioUrl(null);
    setTranscript('');
    setIsPlaying(false);
    setError(null);
    setShowTranscript(false);
    setLanguageSupported(true);
    
    const checkExistingVoiceScript = async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/reports/${personaId}/voice-script`);
        if (response.ok) {
          const data = await response.json();
          if (data.audioUrl) {
            const servedUrl = data.audioUrl.replace('/objects/', '/api/voice-audio/');
            setAudioUrl(servedUrl);
            setTranscript(data.transcript || '');
            setState('ready');
          }
        }
      } catch (err) {
        console.warn('[VoicePlayer] Failed to check existing voice script:', err);
      }
    };
    
    checkExistingVoiceScript();
  }, [sessionId, personaId]);

  const safeParseJson = async (response: Response): Promise<any> => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: text || 'Unknown server error' };
    }
  };

  const generateVoiceNotes = async () => {
    setError(null);
    setState('generating_script');

    try {
      const scriptResponse = await fetch(
        `/api/sessions/${sessionId}/reports/${personaId}/voice-script`,
        { method: 'POST' }
      );

      const scriptData = await safeParseJson(scriptResponse);

      if (!scriptResponse.ok) {
        throw new Error(scriptData.error || 'Failed to generate script');
      }

      setTranscript(scriptData.transcript);

      if (scriptData.audioUrl) {
        const servedUrl = scriptData.audioUrl.replace('/objects/', '/api/voice-audio/');
        setAudioUrl(servedUrl);
        setState('ready');
        return;
      }

      setState('generating_audio');

      const audioResponse = await fetch(
        `/api/sessions/${sessionId}/reports/${personaId}/voice-audio`,
        { method: 'POST' }
      );

      const audioData = await safeParseJson(audioResponse);

      if (!audioResponse.ok) {
        if (audioData.languageSupported === false) {
          setLanguageSupported(false);
          setState('ready');
          return;
        }
        throw new Error(audioData.error || 'Failed to generate audio');
      }

      if (!audioData.languageSupported) {
        setLanguageSupported(false);
        setState('ready');
        return;
      }

      const servedUrl = audioData.audioUrl.replace('/objects/', '/api/voice-audio/');
      setAudioUrl(servedUrl);
      setState('ready');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const retry = () => {
    setError(null);
    setState('idle');
  };

  if (state === 'idle') {
    return (
      <button
        onClick={generateVoiceNotes}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold rounded-xl hover:from-indigo-600 hover:to-purple-600 transition-all shadow-sm"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
        {buttonLabel}
      </button>
    );
  }

  if (state === 'generating_script' || state === 'generating_audio') {
    return (
      <div className="w-full p-4 bg-slate-50 rounded-xl">
        <div className="flex items-center justify-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
          <span className="text-sm font-medium text-slate-600">
            {state === 'generating_script' ? generatingScriptLabel : generatingAudioLabel}
          </span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="w-full p-4 bg-red-50 rounded-xl">
        <p className="text-sm text-red-600 mb-2">{error}</p>
        <button
          onClick={retry}
          className="text-sm font-semibold text-red-600 hover:text-red-700"
        >
          {isEnglish ? 'Try again' : '重試'}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" />
      )}

      <div className="flex gap-2">
        {audioUrl && languageSupported ? (
          <button
            onClick={togglePlayPause}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold rounded-xl hover:from-indigo-600 hover:to-purple-600 transition-all"
          >
            {isPlaying ? (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                {pauseLabel}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {playLabel}
              </>
            )}
          </button>
        ) : (
          <div className="flex-1 px-4 py-3 bg-slate-100 text-slate-500 font-medium rounded-xl text-center text-sm">
            {voiceUnavailableLabel}
          </div>
        )}

        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="px-4 py-3 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors"
          title={showTranscript ? hideTranscriptLabel : showTranscriptLabel}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>

      {showTranscript && transcript && (
        <div className="p-4 bg-slate-50 rounded-xl max-h-64 overflow-y-auto">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            {isEnglish ? 'Transcript' : '文字稿'}
          </p>
          <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
            {transcript}
          </div>
        </div>
      )}
    </div>
  );
};
