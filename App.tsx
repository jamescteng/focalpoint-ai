
import React, { useState, useEffect } from 'react';
import { AppState, Project, AgentReport } from './types';
import { PERSONAS } from './constants.tsx';
import { UploadForm } from './components/UploadForm';
import { ProcessingQueue } from './components/ProcessingQueue';
import { ScreeningRoom } from './components/ScreeningRoom';
import { generateAgentReport, fileToBytes } from './geminiService';
import { Button } from './components/Button';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.KEY_SELECTION);
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [currentAgentIndex, setCurrentAgentIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const aistudio = (window as any).aistudio;

  useEffect(() => {
    const checkKey = async () => {
      try {
        if (aistudio) {
          const hasKey = await aistudio.hasSelectedApiKey();
          if (hasKey) {
            setState(AppState.IDLE);
          }
        }
      } catch (e) {
        console.error("Failed to check key status", e);
      }
    };
    checkKey();
  }, [aistudio]);

  const handleOpenKeySelector = async () => {
    if (aistudio) {
      await aistudio.openSelectKey();
      setState(AppState.IDLE);
    }
  };

  const startAnalysis = async (p: Project) => {
    setErrorMessage(null);
    setProject(p);
    setState(AppState.ANALYZING);
    setStatusMessage('Synchronizing multimodal stream...');
    
    let videoBase64: string | undefined;
    if (p.videoFile) {
      try {
        videoBase64 = await fileToBytes(p.videoFile);
      } catch (e) {
        setErrorMessage("Encoding failed. File might be incompatible.");
        setState(AppState.IDLE);
        return;
      }
    }

    const persona = PERSONAS[0];
    setStatusMessage(`Appraising "${p.title}"...`);
    
    try {
      const report = await generateAgentReport(persona, p, videoBase64);
      setReports([report]);
      videoBase64 = undefined;
      setState(AppState.VIEWING);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "An unexpected error occurred during analysis.");
      setState(AppState.IDLE);
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-slate-900 selection:bg-slate-900 selection:text-white font-sans">
      <nav className="fixed top-0 left-0 w-full p-8 md:p-12 flex justify-between items-center z-50 pointer-events-none">
        <div className="flex items-center gap-6 pointer-events-auto group cursor-pointer" onClick={() => window.location.reload()}>
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center rotate-12 shadow-xl transition-transform group-hover:rotate-0">
            <div className="w-5 h-5 bg-white rounded-lg -rotate-12 group-hover:rotate-0 transition-transform" />
          </div>
          <span className="font-serif text-4xl tracking-tighter italic">FocalPoint</span>
        </div>
      </nav>

      <div className="relative pt-24">
        {state === AppState.KEY_SELECTION && (
          <div className="flex flex-col items-center justify-center min-h-[85vh] px-8 text-center max-w-5xl mx-auto">
            <h1 className="text-7xl md:text-9xl font-serif mb-12 leading-none tracking-tighter text-slate-900">
              Elevate <br/> <span className="italic text-slate-200">Your Edit.</span>
            </h1>
            <p className="text-slate-400 text-2xl md:text-3xl mb-20 leading-relaxed max-w-3xl font-light">
              Professional multimodal intelligence for cinematic evaluation.
            </p>
            <div className="space-y-10 w-full max-w-md">
              <Button onClick={handleOpenKeySelector} className="w-full py-10 rounded-[2.5rem] text-3xl shadow-2xl hover:translate-y-[-4px] font-serif italic">
                Enter Screening
              </Button>
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="block text-[10px] uppercase tracking-[0.5em] text-slate-300 hover:text-slate-900 transition-colors font-black pointer-events-auto">
                Authentication Required →
              </a>
            </div>
          </div>
        )}

        {state === AppState.IDLE && (
          <div className="space-y-12">
            {errorMessage && (
              <div className="max-w-4xl mx-auto mt-24 p-10 bg-rose-50 border border-rose-100 rounded-[2.5rem] text-rose-600 text-xl text-center font-serif italic">
                {errorMessage}
              </div>
            )}
            <UploadForm onStart={startAnalysis} />
          </div>
        )}

        {state === AppState.ANALYZING && project && (
          <div className="flex flex-col items-center">
            <ProcessingQueue 
              personas={PERSONAS} 
              currentIndex={currentAgentIndex} 
              progress={75}
            />
            <p className="text-slate-300 text-sm uppercase tracking-[0.6em] mt-12 animate-pulse font-black">{statusMessage}</p>
          </div>
        )}

        {state === AppState.VIEWING && project && (
          <ScreeningRoom project={project} reports={reports} />
        )}
      </div>

      {/* Atmospheric Background Decor */}
      <div className="fixed inset-0 pointer-events-none -z-10 opacity-40">
        <div className="absolute top-0 right-0 w-[90vw] h-[90vh] bg-slate-50 rounded-full blur-[250px]" />
        <div className="absolute bottom-0 left-0 w-[60vw] h-[60vh] bg-blue-50/40 rounded-full blur-[250px]" />
      </div>
    </div>
  );
};

export default App;
