
import React, { useState, useRef } from 'react';
import { Project, AgentReport, Persona } from '../types';
import { PERSONAS } from '../constants.tsx';
import { Button } from './Button';

interface ScreeningRoomProps {
  project: Project;
  reports: AgentReport[];
}

const getSeverityColor = (severity: number) => {
  if (severity >= 4) return 'bg-red-100 text-red-800 border-red-200';
  if (severity >= 3) return 'bg-orange-100 text-orange-800 border-orange-200';
  if (severity >= 2) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

const getCategoryIcon = (category: string) => {
  const icons: Record<string, string> = {
    emotion: '💫',
    craft: '🎬',
    clarity: '💡',
    marketability: '📈',
    pacing: '⏱️',
    character: '👤',
    audio: '🔊',
    visual: '👁️',
    tone: '🎭'
  };
  return icons[category] || '📌';
};

export const ScreeningRoom: React.FC<ScreeningRoomProps> = ({ project, reports }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeTab, setActiveTab] = useState<'highlights' | 'concerns'>('highlights');
  const activeReport = reports[0];
  const activePersona = PERSONAS[0];

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  };

  if (!activeReport || !activePersona) {
    return <div className="p-24 text-center text-slate-400 text-2xl font-light">Analysis session could not be retrieved.</div>;
  }

  return (
    <div className="min-h-screen bg-[#fcfcfc] flex flex-col text-slate-900">
      <header className="border-b border-slate-100 px-8 py-8 flex justify-between items-center bg-white/90 backdrop-blur-2xl sticky top-0 z-40">
        <div>
          <h2 className="text-3xl font-serif text-slate-900 tracking-tight">{project.title}</h2>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">Appraisal Finalized</p>
          </div>
        </div>
        <Button variant="outline" size="md" className="rounded-full px-8 border-slate-200" onClick={() => window.location.reload()}>New Screening</Button>
      </header>

      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12">
        <div className="xl:col-span-8 p-8 md:p-12 lg:p-16 overflow-y-auto space-y-20 border-r border-slate-100">
          
          <section>
            <div className="aspect-video bg-black rounded-[2.5rem] overflow-hidden shadow-[0_48px_80px_-24px_rgba(0,0,0,0.15)] border-4 border-white">
              <video 
                ref={videoRef}
                src={project.videoUrl} 
                controls 
                playsInline
                preload="auto"
                className="w-full h-full"
              />
            </div>
          </section>

          <section className="space-y-10">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setActiveTab('highlights')}
                className={`px-6 py-3 rounded-full text-sm font-bold uppercase tracking-widest transition-all ${
                  activeTab === 'highlights' 
                    ? 'bg-emerald-600 text-white' 
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                Highlights ({activeReport.highlights?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('concerns')}
                className={`px-6 py-3 rounded-full text-sm font-bold uppercase tracking-widest transition-all ${
                  activeTab === 'concerns' 
                    ? 'bg-rose-600 text-white' 
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                Concerns ({activeReport.concerns?.length || 0})
              </button>
              <div className="h-[1px] flex-1 bg-slate-100" />
            </div>

            {activeTab === 'highlights' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {activeReport.highlights?.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => seekTo(h.seconds)}
                    className="group flex flex-col bg-white border border-emerald-100 rounded-[2rem] p-8 hover:shadow-xl hover:border-emerald-400 transition-all text-left"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-bold px-4 py-1.5 bg-slate-900 text-white rounded-full">{h.timestamp}</span>
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 flex items-center gap-1.5">
                        {getCategoryIcon(h.category)} {h.category}
                      </span>
                    </div>
                    <p className="text-lg text-slate-800 leading-relaxed font-medium mb-3">{h.summary}</p>
                    <p className="text-sm text-slate-500 leading-relaxed italic">{h.why_it_works}</p>
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'concerns' && (
              <div className="grid grid-cols-1 gap-6">
                {activeReport.concerns?.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => seekTo(c.seconds)}
                    className="group flex flex-col bg-white border border-rose-100 rounded-[2rem] p-8 hover:shadow-xl hover:border-rose-400 transition-all text-left"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold px-4 py-1.5 bg-slate-900 text-white rounded-full">{c.timestamp}</span>
                        <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 flex items-center gap-1.5">
                          {getCategoryIcon(c.category)} {c.category}
                        </span>
                      </div>
                      <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider border ${getSeverityColor(c.severity)}`}>
                        Severity {c.severity}/5
                      </span>
                    </div>
                    <p className="text-lg text-slate-800 leading-relaxed font-semibold mb-2">{c.issue}</p>
                    <p className="text-sm text-rose-700 leading-relaxed mb-4 font-medium">Impact: {c.impact}</p>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Suggested Fix</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{c.suggested_fix}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="bg-slate-50 p-12 md:p-16 rounded-[3.5rem] border border-slate-100">
            <h3 className="text-2xl font-serif text-slate-900 mb-10 border-b border-slate-200 pb-8">Executive Summary</h3>
            <div className="max-w-none text-slate-700 leading-[2.1] text-xl font-light">
              {(activeReport.executive_summary || (activeReport as any).summary || '').split('\n').map((para, i) => <p key={i} className="mb-8">{para}</p>)}
            </div>
          </section>
        </div>

        <div className="xl:col-span-4 bg-white flex flex-col h-screen overflow-y-auto">
          
          <div className="p-10 border-b border-slate-50">
            <div className="flex flex-col items-center text-center mb-10">
              <div className="relative mb-6">
                <img 
                  src={activePersona.avatar} 
                  alt={activePersona.name} 
                  className="w-36 h-36 rounded-[2.5rem] object-cover border-4 border-white shadow-2xl" 
                />
              </div>
              <h4 className="text-3xl font-serif text-slate-900 mb-1">{activePersona.name}</h4>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.3em]">{activePersona.role}</p>
            </div>
            
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-2xl p-6">
                <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-2">Primary Market</p>
                <p className="text-lg text-slate-900 font-semibold">{activePersona.demographics.segment}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-6">
                <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-2">Reviewer Profile</p>
                <p className="text-base text-slate-600 leading-relaxed font-light italic">"{activePersona.demographics.background}"</p>
              </div>
            </div>
          </div>

          <div className="p-10 space-y-12">
            <h3 className="text-xs font-black uppercase tracking-[0.4em] text-slate-300">Target Response Data</h3>
            
            <div className="space-y-12">
              {activeReport.answers.map((qa, i) => (
                <div key={i} className="group">
                  <div className="mb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Goal 0{i+1}</span>
                    </div>
                    <h4 className="text-xl font-bold text-slate-900 tracking-tight leading-snug">{qa.question}</h4>
                  </div>
                  <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100 group-hover:bg-white group-hover:shadow-lg transition-all">
                    <p className="text-lg text-slate-600 leading-relaxed font-light italic">
                      "{qa.answer}"
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
