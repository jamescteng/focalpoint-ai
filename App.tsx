import React, { useState } from 'react';
import { AppState, Project, AgentReport } from './types';
import { PERSONAS } from './constants.tsx';
import { UploadForm } from './components/UploadForm';
import { ProcessingQueue } from './components/ProcessingQueue';
import { ScreeningRoom } from './components/ScreeningRoom';
import { analyzeWithPersona, uploadVideo, UploadResult } from './geminiService';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processProgress, setProcessProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [analyzingPersonaId, setAnalyzingPersonaId] = useState<string | null>(null);

  const startAnalysis = async (p: Project) => {
    setErrorMessage(null);
    setProject(p);
    setState(AppState.ANALYZING);
    setProcessProgress(5);
    setReports([]);
    setUploadResult(null);
    
    const isZH = p.language === 'zh-TW';
    let currentUploadResult: UploadResult | null = null;
    
    if (p.videoFile) {
      try {
        setStatusMessage(isZH ? "上傳視頻中..." : "Uploading video to analysis engine...");
        currentUploadResult = await uploadVideo(p.videoFile, (progress) => {
          setProcessProgress(Math.floor(progress * 0.4));
        });
        setUploadResult(currentUploadResult);
        setProcessProgress(40);
        setStatusMessage(isZH ? "視頻處理完成" : "Video uploaded and processed");
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
    } catch (err: any) {
      console.error("[FocalPoint] Additional Persona Error:", err);
      setAnalyzingPersonaId(null);
      setStatusMessage('');
      alert(err.message || "Failed to generate additional report.");
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
        <div className="flex items-center gap-6 pointer-events-auto group cursor-pointer" onClick={() => window.location.reload()}>
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center rotate-12 shadow-xl transition-transform group-hover:rotate-0">
            <div className="w-5 h-5 bg-white rounded-lg -rotate-12 group-hover:rotate-0 transition-transform" />
          </div>
          <span className="font-serif text-4xl tracking-tighter italic font-bold">FocalPoint</span>
        </div>
      </nav>

      <div className="relative pt-24 pb-20">
        {state === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {errorMessage && (
              <div className="max-w-4xl mx-auto mt-24 p-10 bg-rose-50 border border-rose-200 rounded-[2.5rem] text-rose-700 text-xl text-center font-serif italic">
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
