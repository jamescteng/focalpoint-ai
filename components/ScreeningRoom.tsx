import React, { useState, useRef, useEffect } from 'react';
import { Project, AgentReport, Persona, VideoFingerprint } from '../types';
import { PERSONAS } from '../constants.tsx';
import { Button } from './Button';
import { Card, Badge, Pill, SeverityPill, Tabs } from './ui';

interface ScreeningRoomProps {
  project: Project;
  reports: AgentReport[];
  availablePersonas: Persona[];
  onAddPersona: (personaId: string) => void;
  onVideoReattach: (file: File, videoUrl: string) => void;
  isAnalyzing: boolean;
  analyzingPersonaId: string | null;
  statusMessage: string;
}

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
    cultural_resonance: '🌐',
    emotional_pull: '❤️',
    relatability: '🤝',
    confusion: '❓',
    pacing_drag: '🐌',
    stakes_unclear: '🎯',
    message_clarity: '📢',
    emotional_authenticity: '💯',
    ethical_storytelling: '⚖️',
    impact_potential: '🚀',
    message_confusion: '🌫️',
    ethical_tension: '⚠️',
    emotional_manipulation: '🎭',
    lack_of_context: '📋',
    trust_gap: '🔓'
  };
  return icons[category] || '📌';
};

const formatCategory = (category: string) => {
  return category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const ExpandableContent: React.FC<{ content: string; maxLength?: number }> = ({ 
  content, 
  maxLength = 120 
}) => {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = content.length > maxLength;
  
  if (!shouldTruncate) {
    return <p className="text-[15px] text-slate-600 leading-relaxed">{content}</p>;
  }
  
  return (
    <div>
      <p className="text-[15px] text-slate-600 leading-relaxed">
        {expanded ? content : `${content.slice(0, maxLength)}...`}
      </p>
      <button 
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 mt-2"
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
};

const verifyFingerprint = (file: File, fingerprint: VideoFingerprint): { match: boolean; issues: string[] } => {
  const issues: string[] = [];
  
  if (file.name !== fingerprint.fileName) {
    issues.push(`File name differs: expected "${fingerprint.fileName}", got "${file.name}"`);
  }
  if (file.size !== fingerprint.fileSize) {
    issues.push(`File size differs: expected ${formatFileSize(fingerprint.fileSize)}, got ${formatFileSize(file.size)}`);
  }
  if (file.lastModified !== fingerprint.lastModified) {
    issues.push(`Last modified date differs`);
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
  statusMessage
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'highlights' | 'concerns'>('summary');
  const [activeReportIndex, setActiveReportIndex] = useState(0);
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'profile' | 'goals'>('profile');
  const [fingerprintWarning, setFingerprintWarning] = useState<{ file: File; issues: string[] } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  
  const activeReport = reports[activeReportIndex];
  const activePersona = PERSONAS.find(p => p.id === activeReport?.personaId) || PERSONAS[0];

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

  if (!activeReport || !activePersona) {
    return <div className="p-24 text-center text-slate-400 text-xl">Analysis session could not be retrieved.</div>;
  }

  const contentTabs = [
    { id: 'summary', label: 'Summary', color: 'blue' as const },
    { id: 'highlights', label: 'Highlights', count: activeReport.highlights?.length || 0, color: 'emerald' as const },
    { id: 'concerns', label: 'Concerns', count: activeReport.concerns?.length || 0, color: 'rose' as const },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800">
      <header className="border-b border-slate-200/70 px-6 py-5 flex justify-between items-center bg-white sticky top-0 z-40">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">{project.title}</h2>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              {reports.length} Report{reports.length > 1 ? 's' : ''} Generated
            </p>
          </div>
        </div>
        <Button variant="outline" size="md" className="rounded-lg px-5 border-slate-200" onClick={() => window.location.reload()}>
          New Screening
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
                  alt={persona.name}
                  className="w-7 h-7 rounded-full object-cover"
                />
                <span className="font-semibold text-sm">{persona.name}</span>
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
              <span className="font-semibold text-sm">Analyzing...</span>
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
              <span className="font-semibold text-sm">Add Reviewer</span>
            </button>
          )}
        </div>

        {availablePersonas.length > 0 && !isAnalyzing && showAddPersona && (
          <div className="relative mt-3">
            <Card variant="elevated" className="absolute left-0 top-0 p-2 z-[100] min-w-[300px]">
              <div className="px-3 py-2 mb-1 border-b border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Available Reviewers</p>
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
                      alt={persona.name}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{persona.name}</p>
                      <p className="text-xs text-slate-500">{persona.role}</p>
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
            
            {project.videoUrl ? (
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
                <h3 className="text-lg font-semibold text-slate-700 mb-2">Video Not Attached</h3>
                {project.videoFingerprint ? (
                  <p className="text-sm text-slate-500 text-center mb-4 max-w-md">
                    This screening was created from: <span className="font-medium text-slate-700">{project.videoFingerprint.fileName}</span> ({formatFileSize(project.videoFingerprint.fileSize)})
                  </p>
                ) : (
                  <p className="text-sm text-slate-500 text-center mb-4 max-w-md">
                    To play the video and add more reviewers, please reattach the local file.
                  </p>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Attach Local File
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
                      <h3 className="text-lg font-bold text-slate-900 mb-1">File Mismatch Detected</h3>
                      <p className="text-sm text-slate-600">This doesn't appear to be the same file used in the original screening.</p>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50 rounded-xl p-4 mb-4">
                    <ul className="text-sm text-slate-600 space-y-1">
                      {fingerprintWarning.issues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5">•</span>
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => setFingerprintWarning(null)}
                      className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      Choose Different File
                    </button>
                    <button
                      onClick={handleConfirmMismatchedFile}
                      className="flex-1 px-4 py-3 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors"
                    >
                      Use Anyway
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeReport.highlights?.map((h, i) => (
                  <Card
                    key={i}
                    as="button"
                    variant="highlight"
                    onClick={() => seekTo(h.seconds)}
                    className="p-5 text-left flex flex-col"
                  >
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Badge variant="dark">{h.timestamp}</Badge>
                      <Pill icon={getCategoryIcon(h.category)} variant="highlight">
                        {formatCategory(h.category)}
                      </Pill>
                    </div>
                    <p className="text-[15px] text-slate-800 font-medium mb-2 leading-snug">{h.summary}</p>
                    <ExpandableContent content={h.why_it_works} />
                  </Card>
                ))}
              </div>
            )}

            {activeTab === 'concerns' && (
              <div className="space-y-4">
                {activeReport.concerns?.map((c, i) => (
                  <Card
                    key={i}
                    as="button"
                    variant="concern"
                    onClick={() => seekTo(c.seconds)}
                    className="p-5 text-left"
                  >
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Badge variant="dark">{c.timestamp}</Badge>
                      <Pill icon={getCategoryIcon(c.category)} variant="default">
                        {formatCategory(c.category)}
                      </Pill>
                      <SeverityPill severity={c.severity} />
                    </div>
                    <p className="text-[15px] text-slate-800 font-semibold mb-2 leading-snug">{c.issue}</p>
                    <p className="text-sm text-rose-600 font-medium mb-3">Impact: {c.impact}</p>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Suggested Fix</p>
                      <p className="text-sm text-slate-600 leading-relaxed">{c.suggested_fix}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="xl:col-span-4 bg-white flex flex-col sticky top-[73px] h-[calc(100vh-73px)] overflow-y-auto">
          
          <div className="p-6 border-b border-slate-100">
            <div className="flex flex-col items-center text-center mb-6">
              <img 
                src={activePersona.avatar} 
                alt={activePersona.name} 
                className="w-24 h-24 rounded-2xl object-cover shadow-card mb-4" 
              />
              <h4 className="text-lg font-bold text-slate-900">{activePersona.name}</h4>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{activePersona.role}</p>
              {activePersona.focusAreas && (
                <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                  {activePersona.focusAreas.map((area, idx) => (
                    <span key={idx} className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                      {area}
                    </span>
                  ))}
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
                Profile
              </button>
              <button
                onClick={() => setRightPanelTab('goals')}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  rightPanelTab === 'goals' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                Goals ({activeReport.answers.length})
              </button>
            </div>
          </div>

          <div className="flex-1 p-6 overflow-y-auto">
            {rightPanelTab === 'profile' && (
              <div className="space-y-4">
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Primary Market</p>
                  <p className="text-base text-slate-900 font-semibold">{activePersona.demographics.segment}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Background</p>
                  <p className="text-sm text-slate-600 leading-relaxed">"{activePersona.demographics.background}"</p>
                </Card>
              </div>
            )}

            {rightPanelTab === 'goals' && (
              <div className="space-y-4">
                {activeReport.answers.map((qa, i) => (
                  <Card key={i} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Goal {i + 1}</span>
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
