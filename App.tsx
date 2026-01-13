import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Project, AgentReport } from './types';
import { PERSONAS } from './constants.tsx';
import { UploadForm } from './components/UploadForm';
import { ProcessingQueue } from './components/ProcessingQueue';
import { ScreeningRoom } from './components/ScreeningRoom';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { 
  analyzeWithPersona, 
  uploadVideo, 
  UploadResult,
  createSession,
  getSessions,
  getReportsBySession,
  updateSession,
  saveReport,
  deleteSession,
  DbSession,
  DbReport
} from './geminiService';

function generateAttemptId(): string {
  return `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function dbReportToAgentReport(dbReport: DbReport): AgentReport {
  return {
    personaId: dbReport.personaId,
    executive_summary: dbReport.executiveSummary,
    highlights: dbReport.highlights,
    concerns: dbReport.concerns,
    answers: dbReport.answers,
    validationWarnings: dbReport.validationWarnings,
  };
}

const App: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processProgress, setProcessProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [analyzingPersonaId, setAnalyzingPersonaId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const uploadLockRef = useRef(false);
  
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [currentSession, setCurrentSession] = useState<DbSession | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoadingSessions(true);
      const loadedSessions = await getSessions();
      setSessions(loadedSessions);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadSession = async (session: DbSession) => {
    try {
      const dbReports = await getReportsBySession(session.id);
      const agentReports = dbReports.map(dbReportToAgentReport);
      
      setCurrentSessionId(session.id);
      setCurrentSession(session);
      const uniquePersonaIds = [...new Set(dbReports.map(r => r.personaId))];
      setProject({
        id: String(session.id),
        title: session.title,
        synopsis: session.synopsis,
        questions: session.questions,
        language: session.language as 'en' | 'zh-TW',
        selectedPersonaIds: uniquePersonaIds,
        youtubeUrl: session.youtubeUrl || undefined,
        youtubeEmbeddable: session.youtubeEmbeddable ?? undefined,
        videoFingerprint: session.fileName && session.fileSize && session.fileLastModified ? {
          fileName: session.fileName,
          fileSize: session.fileSize,
          lastModified: session.fileLastModified,
        } : undefined,
      });
      
      if (session.fileUri && session.fileMimeType && session.fileName) {
        setUploadResult({
          fileUri: session.fileUri,
          fileMimeType: session.fileMimeType,
          fileName: session.fileName,
        });
      }
      
      setReports(agentReports);
      setShowSessionList(false);
      
      if (agentReports.length > 0) {
        setState(AppState.VIEWING);
      } else {
        setState(AppState.IDLE);
      }
    } catch (err: any) {
      console.error('Failed to load session:', err);
      setErrorMessage(t('errors.failedToLoad'));
    }
  };

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t('sessions.deleteConfirm'))) return;
    
    try {
      await deleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setProject(null);
        setReports([]);
        setUploadResult(null);
        setState(AppState.IDLE);
      }
    } catch (err: any) {
      console.error('Failed to delete session:', err);
      alert(t('errors.failedToDelete'));
    }
  };

  const startAnalysis = async (p: Project) => {
    if (uploadLockRef.current) {
      console.warn('[FocalPoint] Upload already in progress, ignoring duplicate submission');
      return;
    }
    uploadLockRef.current = true;
    setIsSubmitting(true);
    
    const attemptId = generateAttemptId();
    console.debug('[FocalPoint] Starting analysis with attemptId:', attemptId);
    
    setErrorMessage(null);
    setProject(p);
    setState(AppState.ANALYZING);
    setProcessProgress(5);
    setReports([]);
    setUploadResult(null);
    
    const isZH = p.language === 'zh-TW';
    let currentUploadResult: UploadResult | null = null;
    let sessionId: number | null = null;
    
    const isYoutubeSession = !!p.youtubeUrl;
    
    try {
      const session = await createSession({
        title: p.title,
        synopsis: p.synopsis,
        questions: p.questions,
        language: p.language,
        youtubeUrl: p.youtubeUrl,
        youtubeEmbeddable: p.youtubeEmbeddable ?? undefined,
      });
      sessionId = session.id;
      setCurrentSessionId(sessionId);
      setCurrentSession(session);
      setSessions(prev => [session, ...prev]);
    } catch (err: any) {
      console.error('Failed to create session:', err);
    }
    
    if (isYoutubeSession) {
      setProcessProgress(50);
      setStatusMessage(t('processing.preparingYoutube'));
    } else if (p.videoFile) {
      try {
        setStatusMessage(t('processing.uploadingVideo'));
        currentUploadResult = await uploadVideo(
          p.videoFile, 
          (progress) => {
            setProcessProgress(progress);
          }, 
          attemptId,
          (message) => {
            setStatusMessage(message);
          }
        );
        setUploadResult(currentUploadResult);
        setStatusMessage(t('processing.videoProcessed'));
        
        if (sessionId) {
          try {
            await updateSession(sessionId, {
              fileUri: currentUploadResult.fileUri,
              fileMimeType: currentUploadResult.fileMimeType,
              fileName: currentUploadResult.fileName,
              fileSize: p.videoFingerprint?.fileSize,
              fileLastModified: p.videoFingerprint?.lastModified,
            });
          } catch (err: any) {
            console.error('Failed to update session with file info:', err);
          }
        }
      } catch (e: any) {
        setErrorMessage(e.message || t('errors.uploadFailed'));
        setState(AppState.IDLE);
        uploadLockRef.current = false;
        setIsSubmitting(false);
        return;
      }
    }

    if (!isYoutubeSession && !currentUploadResult) {
      setErrorMessage(t('errors.videoRequired'));
      setState(AppState.IDLE);
      uploadLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    const personaId = p.selectedPersonaIds[0];
    const persona = PERSONAS.find(per => per.id === personaId);
    
    setAnalyzingPersonaId(personaId);
    setStatusMessage(t('processing.runningAppraisal', { persona: persona?.name || personaId }));
    setProcessProgress(60);
    
    try {
      const report = await analyzeWithPersona(p, currentUploadResult, personaId);
      setReports([report]);
      setProcessProgress(100);
      setAnalyzingPersonaId(null);
      
      if (sessionId) {
        try {
          await saveReport(sessionId, report);
        } catch (err: any) {
          console.error('Failed to save report:', err);
        }
      }
      
      setTimeout(() => setState(AppState.VIEWING), 600);
    } catch (err: any) {
      console.error("[FocalPoint] Pipeline Error:", err);
      setErrorMessage(err.message || t('errors.analysisError'));
      setAnalyzingPersonaId(null);
      setState(AppState.IDLE);
    } finally {
      uploadLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const addPersonaReport = async (personaId: string) => {
    if (!project) return;
    const isYoutubeSession = !!project.youtubeUrl;
    if (!isYoutubeSession && !uploadResult) return;
    if (reports.some(r => r.personaId === personaId)) return;

    const persona = PERSONAS.find(p => p.id === personaId);
    
    setAnalyzingPersonaId(personaId);
    setStatusMessage(t('processing.analyzingWith', { persona: persona?.name || personaId }));

    try {
      const report = await analyzeWithPersona(project, uploadResult, personaId);
      setReports(prev => [...prev, report]);
      setAnalyzingPersonaId(null);
      setStatusMessage('');
      
      if (currentSessionId) {
        try {
          await saveReport(currentSessionId, report);
        } catch (err: any) {
          console.error('Failed to save report:', err);
        }
      }
    } catch (err: any) {
      console.error("[FocalPoint] Additional Persona Error:", err);
      setAnalyzingPersonaId(null);
      setStatusMessage('');
      alert(err.message || t('errors.additionalReportFailed'));
    }
  };

  const startNewSession = () => {
    setCurrentSessionId(null);
    setProject(null);
    setReports([]);
    setUploadResult(null);
    setErrorMessage(null);
    setState(AppState.IDLE);
    setShowSessionList(false);
  };

  const handleVideoReattach = (file: File, videoUrl: string) => {
    if (project) {
      setProject({
        ...project,
        videoFile: file,
        videoUrl: videoUrl,
        videoFingerprint: {
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
        },
      });
    }
  };

  const selectedPersonas = project 
    ? PERSONAS.filter(p => project.selectedPersonaIds.includes(p.id))
    : PERSONAS.slice(0, 1);

  const availablePersonasToAdd = PERSONAS.filter(
    p => !reports.some(r => r.personaId === p.id)
  );

  return (
    <div className="min-h-screen bg-[#fdfdfd] text-slate-900 selection:bg-slate-900 selection:text-white font-sans overflow-x-hidden">
      <nav className="fixed top-0 left-0 w-full px-4 py-4 sm:px-6 sm:py-6 md:px-12 md:py-8 flex justify-between items-center z-50 pointer-events-none">
        <div className="flex items-center gap-2 sm:gap-4 md:gap-6 pointer-events-auto group cursor-pointer" onClick={startNewSession}>
          <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-slate-900 rounded-xl sm:rounded-2xl flex items-center justify-center rotate-12 shadow-xl transition-transform group-hover:rotate-0">
            <div className="w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5 bg-white rounded-md sm:rounded-lg -rotate-12 group-hover:rotate-0 transition-transform" />
          </div>
          <span className="text-lg sm:text-2xl md:text-3xl tracking-tight font-bold">FocalPoint</span>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          {sessions.length > 0 && (
            <button
              onClick={() => setShowSessionList(!showSessionList)}
              className="pointer-events-auto flex items-center gap-1 sm:gap-2 px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 bg-white border border-slate-200 rounded-lg sm:rounded-xl hover:border-slate-400 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden sm:inline text-sm font-medium text-slate-700">{t('nav.history')}</span>
              <span className="text-xs bg-slate-100 text-slate-600 px-1.5 sm:px-2 py-0.5 rounded-full">{sessions.length}</span>
            </button>
          )}
        </div>
      </nav>

      {showSessionList && (
        <div className="fixed inset-0 bg-black/20 z-50" onClick={() => setShowSessionList(false)}>
          <div 
            className="absolute top-16 sm:top-20 md:top-24 right-4 sm:right-6 md:right-12 w-[calc(100vw-2rem)] sm:w-80 max-h-[70vh] bg-white rounded-xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">{t('sessions.previousSessions')}</h3>
              <button
                onClick={startNewSession}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                {t('nav.new')}
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
              {loadingSessions ? (
                <div className="p-8 text-center text-slate-400">{t('sessions.loading')}</div>
              ) : sessions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">{t('sessions.noSessions')}</div>
              ) : (
                sessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => loadSession(session)}
                    className={`p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors group ${
                      currentSessionId === session.id ? 'bg-slate-50' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-900 truncate">{session.title}</h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(session.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className="p-1.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="relative pt-24 pb-20">
        {state === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {errorMessage && (
              <div className="max-w-4xl mx-auto mt-24 p-10 bg-rose-50 border border-rose-200 rounded-[2.5rem] text-rose-700 text-xl text-center font-medium">
                {errorMessage}
              </div>
            )}
            <UploadForm onStart={startAnalysis} isSubmitting={isSubmitting} />
          </div>
        )}

        {state === AppState.ANALYZING && project && (
          <div className="flex flex-col items-center">
            <ProcessingQueue 
              personas={selectedPersonas} 
              currentIndex={0} 
              progress={processProgress}
            />
            <p className="text-slate-400 text-sm uppercase tracking-[0.6em] mt-12 animate-pulse font-black">{statusMessage}</p>
          </div>
        )}

        {state === AppState.VIEWING && project && reports.length > 0 && (
          <div className="animate-in fade-in duration-1000">
            <ScreeningRoom 
              project={project} 
              reports={reports}
              availablePersonas={availablePersonasToAdd}
              onAddPersona={addPersonaReport}
              onVideoReattach={handleVideoReattach}
              isAnalyzing={analyzingPersonaId !== null}
              analyzingPersonaId={analyzingPersonaId}
              statusMessage={statusMessage}
              sessionId={currentSessionId || undefined}
              personaAliases={currentSession?.personaAliases || []}
            />
          </div>
        )}
      </div>

      <div className="fixed inset-0 pointer-events-none -z-10 opacity-30">
        <div className="absolute top-0 right-0 w-[80vw] h-[80vh] bg-slate-100 rounded-full blur-[200px]" />
        <div className="absolute bottom-0 left-0 w-[50vw] h-[50vh] bg-blue-50/50 rounded-full blur-[200px]" />
      </div>
    </div>
  );
};

export default App;
