import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Project, AgentReport, Persona, VideoFingerprint } from '../types';
import { PERSONAS } from '../constants.tsx';
import { Button } from './Button';
import { Card, Tabs, formatFileSize as formatSize } from './ui';
import { VoicePlayer } from './VoicePlayer';
import { ReviewerPairPicker } from './ReviewerPairPicker';
import { DialoguePlayer } from './DialoguePlayer';
import { HighlightsList } from './HighlightCard';
import { ConcernsList } from './ConcernCard';
import { YouTubePlayer, useYouTubePlayer } from './YouTubePlayer';

interface PersonaAlias {
  personaId: string;
  name: string;
  role: string;
}

interface ScreeningRoomProps {
  project: Project;
  reports: AgentReport[];
  availablePersonas: Persona[];
  onAddPersona: (personaId: string) => void;
  onVideoReattach: (file: File, videoUrl: string) => void;
  isAnalyzing: boolean;
  analyzingPersonaId: string | null;
  statusMessage: string;
  sessionId?: number;
  personaAliases?: PersonaAlias[];
}


type FingerprintIssue = { key: string; params?: Record<string, string> };

const verifyFingerprint = (file: File, fingerprint: VideoFingerprint): { match: boolean; issues: FingerprintIssue[] } => {
  const issues: FingerprintIssue[] = [];
  
  if (file.name !== fingerprint.fileName) {
    issues.push({ key: 'screeningRoom.fileNameDiffers', params: { expected: fingerprint.fileName, got: file.name } });
  }
  if (file.size !== fingerprint.fileSize) {
    issues.push({ key: 'screeningRoom.fileSizeDiffers', params: { expected: formatSize(fingerprint.fileSize), got: formatSize(file.size) } });
  }
  if (file.lastModified !== fingerprint.lastModified) {
    issues.push({ key: 'screeningRoom.lastModifiedDiffers' });
  }
  
  return { match: issues.length === 0, issues };
};

export const ScreeningRoom: React.FC<ScreeningRoomProps> = ({ 
  project, 
  reports, 
  availablePersonas,
  onAddPersona,
  onVideoReattach,
  isAnalyzing,
  analyzingPersonaId,
  statusMessage,
  sessionId,
  personaAliases = []
}) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'highlights' | 'concerns'>('summary');
  const [activeReportIndex, setActiveReportIndex] = useState(0);
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'profile' | 'goals'>('profile');
  const [fingerprintWarning, setFingerprintWarning] = useState<{ file: File; issues: FingerprintIssue[] } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  
  const youtubePlayer = useYouTubePlayer();
  const isYoutubeSession = !!project.youtubeUrl;
  
  const activeReport = reports[activeReportIndex];
  const activePersona = PERSONAS.find(p => p.id === activeReport?.personaId) || PERSONAS[0];
  
  const [dialogueJobId, setDialogueJobId] = useState<number | null>(null);
  const [dialogueStatus, setDialogueStatus] = useState<'idle' | 'generating' | 'complete' | 'failed'>('idle');
  const [dialogueResult, setDialogueResult] = useState<{
    audioUrl: string;
    transcript: string;
    participants: Array<{ personaId: string; displayName: string; role: string }>;
    turns: Array<{ speakerPersonaId: string; text: string }>;
  } | null>(null);
  const [dialogueError, setDialogueError] = useState<string | null>(null);
  const [dialoguePair, setDialoguePair] = useState<{ personaIdA: string; personaIdB: string } | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  const getPersonaDisplayName = (personaId: string): string => {
    const alias = personaAliases.find(a => a.personaId === personaId);
    if (alias) return alias.name;
    const persona = PERSONAS.find(p => p.id === personaId);
    return persona?.name || 'Reviewer';
  };
  
  const activePersonaDisplayName = getPersonaDisplayName(activeReport?.personaId);

  useEffect(() => {
    setVideoReady(false);
    setPendingSeek(null);
  }, [project.videoUrl]);

  const handleVideoReady = () => {
    setVideoReady(true);
    if (pendingSeek !== null && videoRef.current) {
      videoRef.current.currentTime = pendingSeek;
      videoRef.current.play().catch(() => {});
      setPendingSeek(null);
    }
  };

  const handleVideoLoadStart = () => {
    setVideoReady(false);
  };

  const seekTo = (seconds: number) => {
    if (isYoutubeSession) {
      youtubePlayer.seekTo(seconds);
      return;
    }
    if (!project.videoUrl) {
      return;
    }
    if (!videoRef.current || !videoReady) {
      setPendingSeek(seconds);
      return;
    }
    try {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    } catch (err) {
      console.warn('[FocalPoint] Seek failed:', err);
    }
  };

  const handleAddPersona = (personaId: string) => {
    setShowAddPersona(false);
    onAddPersona(personaId);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (project.videoFingerprint) {
      const result = verifyFingerprint(file, project.videoFingerprint);
      if (!result.match) {
        setFingerprintWarning({ file, issues: result.issues });
        return;
      }
    }
    
    const videoUrl = URL.createObjectURL(file);
    onVideoReattach(file, videoUrl);
    setFingerprintWarning(null);
  };

  const handleConfirmMismatchedFile = () => {
    if (fingerprintWarning) {
      const videoUrl = URL.createObjectURL(fingerprintWarning.file);
      onVideoReattach(fingerprintWarning.file, videoUrl);
      setFingerprintWarning(null);
    }
  };

  const pollDialogueStatus = useCallback(async (jobId: number) => {
    try {
      const response = await fetch(`/api/dialogue/status/${jobId}`);
      if (!response.ok) throw new Error('Failed to get status');
      
      const data = await response.json();
      
      if (data.status === 'complete') {
        const resultResponse = await fetch(`/api/dialogue/result/${jobId}`);
        if (resultResponse.ok) {
          const result = await resultResponse.json();
          setDialogueResult({
            audioUrl: result.audioUrl,
            transcript: result.transcript,
            participants: result.script.participants,
            turns: result.script.turns
          });
          setDialogueStatus('complete');
          setIsRegenerating(false);
        }
      } else if (data.status === 'failed') {
        setDialogueError(data.error || 'Generation failed');
        setDialogueStatus('failed');
        setIsRegenerating(false);
      } else {
        setTimeout(() => pollDialogueStatus(jobId), 2000);
      }
    } catch (err) {
      console.error('[Dialogue] Poll error:', err);
      setDialogueError('Failed to check status');
      setDialogueStatus('failed');
      setIsRegenerating(false);
    }
  }, []);

  const handleGenerateDialogue = async (personaIdA: string, personaIdB: string, regenerate = false) => {
    if (!sessionId) return;
    if (project.language !== 'en') return;
    
    setDialogueStatus('generating');
    setDialogueError(null);
    if (!regenerate) setDialogueResult(null);
    setDialoguePair({ personaIdA, personaIdB });
    if (regenerate) setIsRegenerating(true);
    
    try {
      const response = await fetch('/api/dialogue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          personaIdA,
          personaIdB,
          language: project.language
        })
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to start dialogue');
      }
      
      const { jobId } = await response.json();
      setDialogueJobId(jobId);
      pollDialogueStatus(jobId);
    } catch (err) {
      console.error('[Dialogue] Create error:', err);
      setDialogueError(err instanceof Error ? err.message : 'Failed to generate dialogue');
      setDialogueStatus('failed');
      setIsRegenerating(false);
    }
  };

  const handleRegenerateDialogue = () => {
    if (dialoguePair) {
      handleGenerateDialogue(dialoguePair.personaIdA, dialoguePair.personaIdB, true);
    } else {
      setDialogueResult(null);
      setDialogueStatus('idle');
      setDialogueJobId(null);
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    
    const fetchExistingDialogue = async () => {
      try {
        const response = await fetch(`/api/dialogue/session/${sessionId}`);
        if (!response.ok) {
          console.warn('[Dialogue] Failed to fetch session dialogues:', response.status);
          return;
        }
        
        const { dialogues } = await response.json();
        if (!dialogues || dialogues.length === 0) return;
        
        const sortedByDate = [...dialogues].sort((a: any, b: any) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        
        const latest = sortedByDate[0];
        
        if (latest.personaA && latest.personaB) {
          setDialoguePair({ personaIdA: latest.personaA, personaIdB: latest.personaB });
        }
        
        if (latest.status === 'complete' && latest.audioStorageKey) {
          const resultResponse = await fetch(`/api/dialogue/result/${latest.id}`);
          if (resultResponse.ok) {
            const result = await resultResponse.json();
            setDialogueResult({
              audioUrl: result.audioUrl,
              transcript: result.transcript,
              participants: result.script.participants,
              turns: result.script.turns
            });
            setDialogueStatus('complete');
            setDialogueJobId(latest.id);
          }
        } else if (latest.status === 'failed') {
          setDialogueJobId(latest.id);
          setDialogueError(latest.lastError || 'Previous generation failed');
          setDialogueStatus('failed');
        } else if (latest.status === 'queued' || latest.status === 'scripting' || latest.status === 'rendering') {
          setDialogueJobId(latest.id);
          setDialogueStatus('generating');
          pollDialogueStatus(latest.id);
        }
      } catch (err) {
        console.error('[Dialogue] Failed to fetch existing:', err);
      }
    };
    
    fetchExistingDialogue();
  }, [sessionId, pollDialogueStatus]);

  const completedPersonaIds = reports.map(r => r.personaId);

  if (!activeReport || !activePersona) {
    return <div className="p-24 text-center text-slate-400 text-xl">Analysis session could not be retrieved.</div>;
  }

  const contentTabs = [
    { id: 'summary', label: t('screeningRoom.summary'), color: 'blue' as const },
    { id: 'highlights', label: t('screeningRoom.highlights'), count: activeReport.highlights?.length || 0, color: 'emerald' as const },
    { id: 'concerns', label: t('screeningRoom.concerns'), count: activeReport.concerns?.length || 0, color: 'rose' as const },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800">
      <header className="border-b border-slate-200/70 px-6 py-5 flex justify-between items-center bg-white sticky top-0 z-40">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">{project.title}</h2>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              {t('screeningRoom.reportsGenerated', { count: reports.length })}
            </p>
          </div>
        </div>
        <Button variant="outline" size="md" className="rounded-lg px-5 border-slate-200" onClick={() => window.location.reload()}>
          {t('screeningRoom.newScreening')}
        </Button>
      </header>

      <div className="border-b border-slate-200/70 px-6 py-3 bg-white">
        <div className="flex items-center gap-2 overflow-x-auto">
          {reports.map((report, index) => {
            const persona = PERSONAS.find(p => p.id === report.personaId);
            if (!persona) return null;
            const isActive = index === activeReportIndex;
            return (
              <button
                key={report.personaId}
                onClick={() => setActiveReportIndex(index)}
                className={`flex items-center gap-2.5 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <img
                  src={persona.avatar}
                  alt={getPersonaDisplayName(persona.id)}
                  className="w-7 h-7 rounded-full object-cover"
                />
                <span className="font-semibold text-sm">{getPersonaDisplayName(persona.id)}</span>
              </button>
            );
          })}

          {isAnalyzing && analyzingPersonaId && (
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-lg bg-blue-50 text-blue-600 whitespace-nowrap">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <span className="font-semibold text-sm">{t('screeningRoom.analyzing')}</span>
            </div>
          )}

          {availablePersonas.length > 0 && !isAnalyzing && (
            <button
              onClick={() => setShowAddPersona(v => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-600 transition-all whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span className="font-semibold text-sm">{t('screeningRoom.addReviewer')}</span>
            </button>
          )}
        </div>

        {availablePersonas.length > 0 && !isAnalyzing && showAddPersona && (
          <div className="relative mt-3">
            <Card variant="elevated" className="absolute left-0 top-0 p-2 z-[100] min-w-[300px]">
              <div className="px-3 py-2 mb-1 border-b border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('screeningRoom.availableReviewers')}</p>
              </div>
              <div className="space-y-1">
                {availablePersonas.map(persona => (
                  <button
                    key={persona.id}
                    onClick={() => handleAddPersona(persona.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-all text-left group"
                  >
                    <img
                      src={persona.avatar}
                      alt={getPersonaDisplayName(persona.id)}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{getPersonaDisplayName(persona.id)}</p>
                      <p className="text-xs text-slate-500">{t(`personas.${persona.id}.role`)}</p>
                    </div>
                    <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      {isAnalyzing && statusMessage && (
        <div className="px-6 py-2 bg-blue-50 border-b border-blue-100">
          <p className="text-blue-600 text-sm font-medium text-center">{statusMessage}</p>
        </div>
      )}

      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12">
        <div className="xl:col-span-8 p-6 lg:p-8 overflow-y-auto space-y-6 border-r border-slate-200/70">
          
          <section>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {isYoutubeSession && project.youtubeUrl ? (
              <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-card relative">
                <YouTubePlayer
                  youtubeUrl={project.youtubeUrl}
                  onReady={youtubePlayer.setPlayer}
                  className="w-full h-full"
                  embeddable={project.youtubeEmbeddable}
                />
              </div>
            ) : project.videoUrl ? (
              <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-card relative">
                <video 
                  ref={videoRef}
                  src={project.videoUrl} 
                  controls 
                  playsInline
                  preload="auto"
                  className="w-full h-full"
                  onLoadStart={handleVideoLoadStart}
                  onCanPlay={handleVideoReady}
                  onLoadedMetadata={handleVideoReady}
                />
                {!videoReady && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-white/80 text-sm font-medium">Loading video...</span>
                    </div>
                  </div>
                )}
                {pendingSeek !== null && videoReady && (
                  <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm">
                    Seeking to {Math.floor(pendingSeek / 60)}:{String(Math.floor(pendingSeek % 60)).padStart(2, '0')}...
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden shadow-card border-2 border-dashed border-slate-300 flex flex-col items-center justify-center p-8">
                <div className="w-16 h-16 bg-slate-200 rounded-2xl flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-700 mb-2">{t('screeningRoom.noVideoAvailable')}</h3>
                {project.videoFingerprint ? (
                  <p className="text-sm text-slate-500 text-center mb-4 max-w-md">
                    {t('screeningRoom.expectedFile', { fileName: project.videoFingerprint.fileName, fileSize: formatSize(project.videoFingerprint.fileSize) })}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500 text-center mb-4 max-w-md">
                    {t('screeningRoom.reattachDescription')}
                  </p>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {t('screeningRoom.selectFile')}
                </button>
              </div>
            )}
            
            {fingerprintWarning && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setFingerprintWarning(null)}>
                <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 mb-1">{t('screeningRoom.fileMismatch')}</h3>
                      <p className="text-sm text-slate-600">{t('screeningRoom.fileMismatchDescription')}</p>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50 rounded-xl p-4 mb-4">
                    <ul className="text-sm text-slate-600 space-y-1">
                      {fingerprintWarning.issues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5">•</span>
                          {t(issue.key, issue.params)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => setFingerprintWarning(null)}
                      className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      {t('screeningRoom.cancel')}
                    </button>
                    <button
                      onClick={handleConfirmMismatchedFile}
                      className="flex-1 px-4 py-3 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors"
                    >
                      {t('screeningRoom.proceedAnyway')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-5">
            <Tabs 
              tabs={contentTabs}
              activeTab={activeTab}
              onTabChange={(id) => setActiveTab(id as 'summary' | 'highlights' | 'concerns')}
            />

            {activeTab === 'summary' && (
              <Card variant="elevated" className="p-6">
                <div className="prose prose-slate max-w-none">
                  <div className="text-[17px] text-slate-700 leading-[1.8] space-y-4">
                    {(activeReport.executive_summary || '').split('\n').filter(p => p.trim()).map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {activeTab === 'highlights' && (
              <HighlightsList highlights={activeReport.highlights || []} onSeek={seekTo} />
            )}

            {activeTab === 'concerns' && (
              <ConcernsList concerns={activeReport.concerns || []} onSeek={seekTo} />
            )}
          </section>

          <section className="mt-8">
            {dialogueStatus === 'complete' && dialogueResult ? (
              <DialoguePlayer
                audioUrl={dialogueResult.audioUrl}
                transcript={dialogueResult.transcript}
                participants={dialogueResult.participants}
                turns={dialogueResult.turns}
                language={project.language as 'en' | 'zh-TW'}
                onRegenerate={handleRegenerateDialogue}
                isRegenerating={isRegenerating}
              />
            ) : dialogueStatus === 'generating' ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {project.language === 'zh-TW' ? 'Podcast 對談' : 'Podcast Dialogue'}
                  </h3>
                  <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">Beta</span>
                </div>
                <div className="flex flex-col items-center py-8 text-gray-500">
                  <svg className="animate-spin h-8 w-8 mb-3 text-indigo-500" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="font-medium">
                    {project.language === 'zh-TW' ? '產生對談中...' : 'Generating dialogue...'}
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    {project.language === 'zh-TW' ? '這可能需要一分鐘' : 'This may take a minute'}
                  </p>
                </div>
              </div>
            ) : dialogueStatus === 'failed' ? (
              <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {project.language === 'zh-TW' ? 'Podcast 對談' : 'Podcast Dialogue'}
                  </h3>
                </div>
                <div className="text-center py-6">
                  <p className="text-red-600 mb-4">{dialogueError}</p>
                  <button
                    onClick={handleRegenerateDialogue}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              </div>
            ) : (
              <ReviewerPairPicker
                availablePersonas={PERSONAS}
                completedPersonaIds={completedPersonaIds}
                language={project.language as 'en' | 'zh-TW'}
                onGenerate={handleGenerateDialogue}
                isGenerating={false}
              />
            )}
          </section>
        </div>

        <div className="xl:col-span-4 bg-white flex flex-col sticky top-[73px] h-[calc(100vh-73px)] overflow-y-auto">
          
          <div className="p-6 border-b border-slate-100">
            <div className="flex flex-col items-center text-center mb-6">
              <img 
                src={activePersona.avatar} 
                alt={activePersonaDisplayName} 
                className="w-24 h-24 rounded-2xl object-cover shadow-card mb-4" 
              />
              <h4 className="text-lg font-bold text-slate-900">{activePersonaDisplayName}</h4>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{t(`personas.${activePersona.id}.role`, { defaultValue: activePersona.role })}</p>
              {activePersona.focusAreas && (
                <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                  {(t(`personas.${activePersona.id}.focusAreas`, { returnObjects: true, defaultValue: activePersona.focusAreas }) as string[]).map((area, idx) => (
                    <span key={idx} className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                      {area}
                    </span>
                  ))}
                </div>
              )}
              
              {sessionId && activeReport && (
                <div className="mt-4 w-full">
                  <VoicePlayer
                    key={`voice-${sessionId}-${activeReport.personaId}`}
                    sessionId={sessionId}
                    personaId={activeReport.personaId}
                    personaName={activePersonaDisplayName}
                    language={project.language}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-3 border-b border-slate-100">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => setRightPanelTab('profile')}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  rightPanelTab === 'profile' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('screeningRoom.profile')}
              </button>
              <button
                onClick={() => setRightPanelTab('goals')}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  rightPanelTab === 'goals' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('screeningRoom.goals')} ({activeReport.answers.length})
              </button>
            </div>
          </div>

          <div className="flex-1 p-6 overflow-y-auto">
            {rightPanelTab === 'profile' && (
              <div className="space-y-4">
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('screeningRoom.primaryMarket')}</p>
                  <p className="text-base text-slate-900 font-semibold">{t(`personas.${activePersona.id}.segment`)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('screeningRoom.background')}</p>
                  <p className="text-sm text-slate-600 leading-relaxed">"{t(`personas.${activePersona.id}.background`)}"</p>
                </Card>
              </div>
            )}

            {rightPanelTab === 'goals' && (
              <div className="space-y-4">
                {activeReport.answers.map((qa, i) => (
                  <Card key={i} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('screeningRoom.goalNumber', { number: i + 1 })}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900 mb-3 leading-snug">{qa.question}</h4>
                    <p className="text-sm text-slate-600 leading-relaxed">"{qa.answer}"</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
