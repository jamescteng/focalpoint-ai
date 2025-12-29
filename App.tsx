import React, { useState, useEffect } from 'react';
import { AppState, Project, AgentReport } from './types';
import { PERSONAS } from './constants.tsx';
import { UploadForm } from './components/UploadForm';
import { ProcessingQueue } from './components/ProcessingQueue';
import { ScreeningRoom } from './components/ScreeningRoom';
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
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processProgress, setProcessProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [analyzingPersonaId, setAnalyzingPersonaId] = useState<string | null>(null);
  
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
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
      const uniquePersonaIds = [...new Set(dbReports.map(r => r.personaId))];
      setProject({
        id: String(session.id),
        title: session.title,
        synopsis: session.synopsis,
        questions: session.questions,
        language: session.language as 'en' | 'zh-TW',
        selectedPersonaIds: uniquePersonaIds,
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
      setErrorMessage('Failed to load session. Please try again.');
    }
  };

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session and all its reports?')) return;
    
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
      alert('Failed to delete session.');
    }
  };

  const startAnalysis = async (p: Project) => {
    setErrorMessage(null);
    setProject(p);
    setState(AppState.ANALYZING);
    setProcessProgress(5);
    setReports([]);
    setUploadResult(null);
    
    const isZH = p.language === 'zh-TW';
    let currentUploadResult: UploadResult | null = null;
    let sessionId: number | null = null;
    
    try {
      const session = await createSession({
        title: p.title,
        synopsis: p.synopsis,
        questions: p.questions,
        language: p.language,
      });
      sessionId = session.id;
      setCurrentSessionId(sessionId);
      setSessions(prev => [session, ...prev]);
    } catch (err: any) {
      console.error('Failed to create session:', err);
    }
    
    if (p.videoFile) {
      try {
        setStatusMessage(isZH ? "上傳視頻中..." : "Uploading video to analysis engine...");
        currentUploadResult = await uploadVideo(p.videoFile, (progress) => {
          setProcessProgress(Math.floor(progress * 0.4));
        });
        setUploadResult(currentUploadResult);
        setProcessProgress(40);
        setStatusMessage(isZH ? "視頻處理完成" : "Video uploaded and processed");
        
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
        setErrorMessage(e.message || "Failed to upload video file.");
        setState(AppState.IDLE);
        return;
      }
    }

    if (!currentUploadResult) {
      setErrorMessage("Video file is required for analysis.");
      setState(AppState.IDLE);
      return;
    }

    const personaId = p.selectedPersonaIds[0];
    const persona = PERSONAS.find(per => per.id === personaId);
    
    setAnalyzingPersonaId(personaId);
    setStatusMessage(
      isZH 
        ? `正在執行深度分析: ${persona?.name || personaId}...` 
        : `Running deep appraisal with ${persona?.name || personaId}...`
    );
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
      setErrorMessage(err.message || "The appraisal engine encountered a technical fault.");
      setAnalyzingPersonaId(null);
      setState(AppState.IDLE);
    }
  };

  const addPersonaReport = async (personaId: string) => {
    if (!project || !uploadResult) return;
    if (reports.some(r => r.personaId === personaId)) return;

    const isZH = project.language === 'zh-TW';
    const persona = PERSONAS.find(p => p.id === personaId);
    
    setAnalyzingPersonaId(personaId);
    setStatusMessage(
      isZH 
        ? `正在分析: ${persona?.name || personaId}...` 
        : `Analyzing with ${persona?.name || personaId}...`
    );

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
      alert(err.message || "Failed to generate additional report.");
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
      <nav className="fixed top-0 left-0 w-full p-8 md:p-12 flex justify-between items-center z-50 pointer-events-none">
        <div className="flex items-center gap-6 pointer-events-auto group cursor-pointer" onClick={startNewSession}>
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center rotate-12 shadow-xl transition-transform group-hover:rotate-0">
            <div className="w-5 h-5 bg-white rounded-lg -rotate-12 group-hover:rotate-0 transition-transform" />
          </div>
          <span className="text-3xl tracking-tight font-bold">FocalPoint</span>
        </div>
        
        {sessions.length > 0 && (
          <button
            onClick={() => setShowSessionList(!showSessionList)}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:border-slate-400 transition-colors shadow-sm"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-slate-700">History</span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{sessions.length}</span>
          </button>
        )}
      </nav>

      {showSessionList && (
        <div className="fixed inset-0 bg-black/20 z-50" onClick={() => setShowSessionList(false)}>
          <div 
            className="absolute top-24 right-8 md:right-12 w-80 max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">Previous Sessions</h3>
              <button
                onClick={startNewSession}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                + New
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
              {loadingSessions ? (
                <div className="p-8 text-center text-slate-400">Loading...</div>
              ) : sessions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">No sessions yet</div>
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
            <UploadForm onStart={startAnalysis} />
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
