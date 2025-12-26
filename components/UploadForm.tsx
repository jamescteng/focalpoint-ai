import React, { useState } from 'react';
import { Button } from './Button';
import { Project } from '../types';
import { INITIAL_QUESTIONS, PERSONAS } from '../constants.tsx';

interface UploadFormProps {
  onStart: (project: Project) => void;
}

export const UploadForm: React.FC<UploadFormProps> = ({ onStart }) => {
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [srt, setSrt] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<'en' | 'zh-TW'>('en');
  const [questions, setQuestions] = useState<string[]>(INITIAL_QUESTIONS);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('acquisitions_director');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) return;

    onStart({
      id: Math.random().toString(36).substr(2, 9),
      title,
      synopsis,
      srtContent: srt,
      videoFile,
      videoUrl: URL.createObjectURL(videoFile),
      questions,
      language,
      selectedPersonaIds: [selectedPersonaId]
    });
  };

  const addQuestion = () => setQuestions([...questions, ""]);
  const updateQuestion = (idx: number, val: string) => {
    const next = [...questions];
    next[idx] = val;
    setQuestions(next);
  };
  const removeQuestion = (idx: number) => {
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  return (
    <div className="max-w-4xl mx-auto py-12 md:py-24 px-6 font-sans">
      <div className="text-center mb-16 md:mb-24">
        <h1 className="text-6xl md:text-8xl font-serif text-slate-900 mb-8 tracking-tighter italic font-bold">Project Ingest</h1>
        <p className="text-slate-500 text-xl md:text-2xl max-w-2xl mx-auto leading-relaxed font-light">
          Submit your cinematic assets for a professional multimodal appraisal.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-16 bg-white p-8 md:p-16 rounded-[3rem] border border-slate-200 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.06)]">
        
        <div className="space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-black bg-slate-900 text-white px-3 py-1 rounded-lg">01</span>
              <label className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Basic Information</label>
            </div>
            
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-6 py-2 text-xs font-bold rounded-lg transition-all ${language === 'en' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
              >
                English Review
              </button>
              <button
                type="button"
                onClick={() => setLanguage('zh-TW')}
                className={`px-6 py-2 text-xs font-bold rounded-lg transition-all ${language === 'zh-TW' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
              >
                繁體中文 (台灣)
              </button>
            </div>
          </div>

          <input
            required
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-8 py-6 text-2xl md:text-3xl focus:ring-2 focus:ring-black focus:bg-white outline-none transition-all font-serif text-slate-900 placeholder:text-slate-200"
            placeholder="Film Title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-black bg-slate-900 text-white px-3 py-1 rounded-lg">02</span>
              <label className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Footage Asset</label>
            </div>
            <div className="relative group h-full">
              <input
                required
                type="file"
                accept="video/*"
                className="hidden"
                id="video-upload"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              />
              <label
                htmlFor="video-upload"
                className="flex flex-col items-center justify-center w-full h-72 border-2 border-dashed border-slate-200 bg-slate-50 rounded-[2.5rem] cursor-pointer hover:border-slate-900 hover:bg-white transition-all"
              >
                {videoFile ? (
                  <div className="text-center px-6">
                    <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-4 mx-auto">
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <p className="text-lg text-slate-900 font-bold mb-1">Asset Loaded</p>
                    <p className="text-xs text-slate-400 truncate max-w-[200px]">{(videoFile.size / (1024 * 1024)).toFixed(0)}MB • {videoFile.name}</p>
                  </div>
                ) : (
                  <div className="text-center px-10">
                    <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mb-6 mx-auto group-hover:scale-110 transition-transform">
                      <svg className="w-6 h-6 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    </div>
                    <span className="text-lg font-bold text-slate-900 block mb-1">Upload Film</span>
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Select Source File</span>
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="text-sm font-black bg-slate-900 text-white px-3 py-1 rounded-lg">03</span>
              <label className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Dialogue context</label>
            </div>
            <textarea
              className="w-full h-72 bg-slate-50 border border-slate-200 rounded-3xl px-8 py-6 focus:ring-2 focus:ring-black focus:bg-white outline-none resize-none text-base leading-relaxed text-slate-900 placeholder:text-slate-300"
              placeholder="Paste dialogue excerpts for deeper narrative context..."
              value={srt}
              onChange={(e) => setSrt(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-black bg-slate-900 text-white px-3 py-1 rounded-lg">04</span>
            <label className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Narrative Synopsis</label>
          </div>
          <textarea
            required
            className="w-full h-44 bg-slate-50 border border-slate-200 rounded-3xl px-8 py-6 focus:ring-2 focus:ring-black focus:bg-white outline-none resize-none text-xl leading-relaxed text-slate-900"
            placeholder="Summarize the core narrative conflict..."
            value={synopsis}
            onChange={(e) => setSynopsis(e.target.value)}
          />
        </div>

        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <span className="text-sm font-black bg-slate-900 text-white px-3 py-1 rounded-lg">05</span>
            <label className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Choose Your Reviewer</label>
          </div>
          <p className="text-slate-500 text-sm -mt-4">Select a professional perspective. You can add more reviewers after seeing the first report.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PERSONAS.map((persona) => {
              const isSelected = selectedPersonaId === persona.id;
              return (
                <button
                  key={persona.id}
                  type="button"
                  onClick={() => setSelectedPersonaId(persona.id)}
                  className={`flex items-start gap-4 p-6 rounded-2xl border-2 transition-all text-left ${
                    isSelected
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:border-slate-400'
                  }`}
                >
                  <img
                    src={persona.avatar}
                    alt={persona.name}
                    className={`w-14 h-14 rounded-xl object-cover ${isSelected ? '' : 'opacity-60'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-900">{persona.name}</span>
                      {isSelected && (
                        <span className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium">{persona.role}</p>
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2">{persona.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-8">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-sm font-black bg-slate-900 text-white px-3 py-1 rounded-lg">06</span>
                <label className="text-sm font-bold uppercase tracking-[0.2em] text-slate-900">Evaluation Objectives</label>
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" className="rounded-full shadow-none border border-slate-200" onClick={addQuestion}>+ Custom Inquiry</Button>
          </div>
          
          <div className="space-y-4">
            {questions.map((q, i) => (
              <div key={i} className="flex gap-4 group">
                <input
                  className="flex-1 bg-white border border-slate-200 rounded-2xl px-8 py-5 text-lg focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none transition-all font-semibold text-slate-900"
                  placeholder={`Question ${i + 1}...`}
                  value={q}
                  onChange={(e) => updateQuestion(i, e.target.value)}
                />
                {questions.length > 1 && (
                  <button type="button" onClick={() => removeQuestion(i)} className="p-4 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-8">
          <Button 
            type="submit" 
            className="w-full py-10 rounded-[2.5rem] text-3xl font-serif italic shadow-2xl hover:translate-y-[-4px]" 
            size="lg"
          >
            Begin Professional Appraisal
          </Button>
        </div>
      </form>
    </div>
  );
};
