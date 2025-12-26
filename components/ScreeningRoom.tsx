import React, { useState, useRef } from 'react';
import { Project, AgentReport, Persona } from '../types';
import { PERSONAS } from '../constants.tsx';
import { Button } from './Button';

interface ScreeningRoomProps {
  project: Project;
  reports: AgentReport[];
  availablePersonas: Persona[];
  onAddPersona: (personaId: string) => void;
  isAnalyzing: boolean;
  analyzingPersonaId: string | null;
  statusMessage: string;
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
    tone: '🎭',
    authorship: '✨',
    cultural_relevance: '🌍',
    emotional_distance: '💔',
    originality: '🎯',
    cultural_resonance: '🌐'
  };
  return icons[category] || '📌';
};

export const ScreeningRoom: React.FC<ScreeningRoomProps> = ({ 
  project, 
  reports, 
  availablePersonas,
  onAddPersona,
  isAnalyzing,
  analyzingPersonaId,
  statusMessage
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeTab, setActiveTab] = useState<'highlights' | 'concerns'>('highlights');
  const [activeReportIndex, setActiveReportIndex] = useState(0);
  const [showAddPersona, setShowAddPersona] = useState(false);
  
  const activeReport = reports[activeReportIndex];
  const activePersona = PERSONAS.find(p => p.id === activeReport?.personaId) || PERSONAS[0];

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  };

  const handleAddPersona = (personaId: string) => {
    setShowAddPersona(false);
    onAddPersona(personaId);
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
            <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">
              {reports.length} Report{reports.length > 1 ? 's' : ''} Generated
            </p>
          </div>
        </div>
        <Button variant="outline" size="md" className="rounded-full px-8 border-slate-200" onClick={() => window.location.reload()}>New Screening</Button>
      </header>

      <div className="border-b border-slate-100 px-8 py-4 bg-white flex items-center gap-3 overflow-x-auto">
        {reports.map((report, index) => {
          const persona = PERSONAS.find(p => p.id === report.personaId);
          if (!persona) return null;
          const isActive = index === activeReportIndex;
          return (
            <button
              key={report.personaId}
              onClick={() => setActiveReportIndex(index)}
              className={`flex items-center gap-3 px-5 py-3 rounded-full transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <img
                src={persona.avatar}
                alt={persona.name}
                className="w-8 h-8 rounded-full object-cover"
              />
              <span className="font-bold text-sm">{persona.name}</span>
            </button>
          );
        })}

        {isAnalyzing && analyzingPersonaId && (
          <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-blue-50 text-blue-600 whitespace-nowrap">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <span className="font-bold text-sm">Analyzing...</span>
          </div>
        )}

        {availablePersonas.length > 0 && !isAnalyzing && (
          <div className="relative">
            <button
              onClick={() => setShowAddPersona(!showAddPersona)}
              className="flex items-center gap-2 px-5 py-3 rounded-full border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-500 hover:text-slate-700 transition-all whitespace-nowrap"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span className="font-bold text-sm">Add Reviewer</span>
            </button>

            {showAddPersona && (
              <div className="absolute top-full left-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-50 min-w-[280px]">
                {availablePersonas.map(persona => (
                  <button
                    key={persona.id}
                    onClick={() => handleAddPersona(persona.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-all text-left"
                  >
                    <img
                      src={persona.avatar}
                      alt={persona.name}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div>
                      <p className="font-bold text-slate-900">{persona.name}</p>
                      <p className="text-xs text-slate-500">{persona.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {isAnalyzing && statusMessage && (
        <div className="px-8 py-3 bg-blue-50 border-b border-blue-100">
          <p className="text-blue-600 text-sm font-medium text-center animate-pulse">{statusMessage}</p>
        </div>
      )}

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
                        {getCategoryIcon(h.category)} {h.category.replace('_', ' ')}
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
                          {getCategoryIcon(c.category)} {c.category.replace('_', ' ')}
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
              {(activeReport.executive_summary || '').split('\n').map((para, i) => <p key={i} className="mb-8">{para}</p>)}
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
