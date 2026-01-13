import React, { useState, useEffect, useRef } from 'react';
import { Button } from './Button';
import { Project } from '../types';
import { INITIAL_QUESTIONS, PERSONAS } from '../constants.tsx';

interface UploadFormProps {
  onStart: (project: Project) => void;
  isSubmitting?: boolean;
}

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

type VideoSourceType = 'upload' | 'youtube';
type YoutubeValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

interface YoutubeValidation {
  status: YoutubeValidationStatus;
  title?: string;
  author?: string;
  error?: string;
  embeddable?: boolean;
}

export const UploadForm: React.FC<UploadFormProps> = ({ onStart, isSubmitting = false }) => {
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoSourceType, setVideoSourceType] = useState<VideoSourceType>('upload');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeError, setYoutubeError] = useState('');
  const [youtubeValidation, setYoutubeValidation] = useState<YoutubeValidation>({ status: 'idle' });
  const [language, setLanguage] = useState<'en' | 'zh-TW'>('en');
  const [questions, setQuestions] = useState<string[]>(INITIAL_QUESTIONS);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('acquisitions_director');
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    if (!youtubeUrl || !isValidYoutubeUrl(youtubeUrl)) {
      setYoutubeValidation({ status: 'idle' });
      return;
    }

    setYoutubeValidation({ status: 'validating' });

    validationTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/sessions/validate-youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ youtubeUrl }),
        });
        const data = await response.json();
        
        if (data.valid) {
          setYoutubeValidation({
            status: 'valid',
            title: data.title,
            author: data.author,
            embeddable: data.embeddable,
          });
          setYoutubeError('');
        } else {
          setYoutubeValidation({
            status: 'invalid',
            error: data.error,
          });
          setYoutubeError(data.error || 'This video cannot be accessed');
        }
      } catch (error) {
        setYoutubeValidation({
          status: 'invalid',
          error: 'Failed to verify video. Please try again.',
        });
        setYoutubeError('Failed to verify video. Please try again.');
      }
    }, 500);

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, [youtubeUrl]);

  const handleYoutubeUrlChange = (url: string) => {
    setYoutubeUrl(url);
    if (url && !isValidYoutubeUrl(url)) {
      setYoutubeError('Please enter a valid YouTube URL');
      setYoutubeValidation({ status: 'idle' });
    } else {
      setYoutubeError('');
    }
  };

  const isFormValid = () => {
    if (isSubmitting) return false;
    if (videoSourceType === 'upload') {
      return !!videoFile;
    } else {
      return youtubeUrl && isValidYoutubeUrl(youtubeUrl) && youtubeValidation.status === 'valid';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid()) return;

    if (videoSourceType === 'youtube') {
      onStart({
        id: Math.random().toString(36).substr(2, 9),
        title,
        synopsis,
        youtubeUrl,
        youtubeEmbeddable: youtubeValidation.embeddable,
        questions,
        language,
        selectedPersonaIds: [selectedPersonaId]
      });
    } else {
      onStart({
        id: Math.random().toString(36).substr(2, 9),
        title,
        synopsis,
        videoFile: videoFile!,
        videoUrl: URL.createObjectURL(videoFile!),
        videoFingerprint: {
          fileName: videoFile!.name,
          fileSize: videoFile!.size,
          lastModified: videoFile!.lastModified,
        },
        questions,
        language,
        selectedPersonaIds: [selectedPersonaId]
      });
    }
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
    <div className="max-w-3xl mx-auto py-8 md:py-16 px-6">
      <div className="text-center mb-10 md:mb-14">
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 mb-3 tracking-tight">A private space to think through your film</h1>
        <p className="text-slate-500 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
          Explore how different viewing perspectives might experience your work.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 bg-white p-6 md:p-10 rounded-2xl border border-slate-200 shadow-sm">
        
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-slate-900 text-white px-2 py-0.5 rounded">01</span>
              <label className="text-xs font-semibold uppercase tracking-widest text-slate-700">Working Title</label>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-slate-400 font-medium">Report language:</span>
              <div className="flex p-0.5 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${language === 'en' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('zh-TW')}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${language === 'zh-TW' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  繁體中文
                </button>
              </div>
            </div>
          </div>

          <input
            required
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-xl md:text-2xl focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none transition-all font-medium text-slate-900 placeholder:text-slate-300"
            placeholder="Enter your film title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-slate-900 text-white px-2 py-0.5 rounded">02</span>
                <label className="text-xs font-semibold uppercase tracking-widest text-slate-700">Video Source</label>
              </div>
              <div className="flex p-0.5 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setVideoSourceType('upload')}
                  className={`px-3 py-1 text-[10px] font-semibold rounded-md transition-all ${videoSourceType === 'upload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => setVideoSourceType('youtube')}
                  className={`px-3 py-1 text-[10px] font-semibold rounded-md transition-all ${videoSourceType === 'youtube' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  YouTube
                </button>
              </div>
            </div>
            
            {videoSourceType === 'upload' ? (
              <div className="relative group">
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  id="video-upload"
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                />
                <label
                  htmlFor="video-upload"
                  className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-200 bg-slate-50 rounded-xl cursor-pointer hover:border-slate-400 hover:bg-white transition-all"
                >
                  {videoFile ? (
                    <div className="text-center px-4">
                      <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mb-3 mx-auto">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className="text-sm text-slate-900 font-semibold mb-0.5">File Selected</p>
                      <p className="text-xs text-slate-400 truncate max-w-[180px]">{(videoFile.size / (1024 * 1024)).toFixed(0)}MB - {videoFile.name}</p>
                    </div>
                  ) : (
                    <div className="text-center px-6">
                      <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center mb-3 mx-auto group-hover:scale-105 transition-transform">
                        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      </div>
                      <span className="text-sm font-semibold text-slate-700 block mb-0.5">Choose file</span>
                      <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Video up to 2GB</span>
                    </div>
                  )}
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                <div className={`flex flex-col items-center justify-center w-full h-48 border-2 rounded-xl p-4 transition-all ${
                  youtubeValidation.status === 'valid' 
                    ? 'border-green-300 bg-green-50' 
                    : youtubeValidation.status === 'invalid' 
                    ? 'border-red-300 bg-red-50' 
                    : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                    youtubeValidation.status === 'valid' ? 'bg-green-600' : 'bg-red-600'
                  }`}>
                    {youtubeValidation.status === 'validating' ? (
                      <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : youtubeValidation.status === 'valid' ? (
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                      </svg>
                    )}
                  </div>
                  <input
                    type="url"
                    placeholder="https://youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => handleYoutubeUrlChange(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none transition-all text-slate-900 placeholder:text-slate-300"
                  />
                  {youtubeValidation.status === 'validating' ? (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 bg-slate-400 rounded-full animate-pulse"></span>
                      Checking video accessibility...
                    </p>
                  ) : youtubeValidation.status === 'valid' ? (
                    <div className="text-center mt-2">
                      <p className="text-xs text-green-700 font-medium flex items-center justify-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                        Video found
                      </p>
                      {youtubeValidation.title && (
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[250px]">
                          {youtubeValidation.title} {youtubeValidation.author && `by ${youtubeValidation.author}`}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">Public videos work best for analysis</p>
                    </div>
                  ) : youtubeError ? (
                    <p className="text-xs text-red-600 mt-1 text-center">{youtubeError}</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-1">Paste a public YouTube video URL</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-slate-900 text-white px-2 py-0.5 rounded">03</span>
              <label className="text-xs font-semibold uppercase tracking-widest text-slate-700">Synopsis</label>
            </div>
            <textarea
              required
              className="w-full h-48 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 focus:ring-2 focus:ring-slate-900 focus:bg-white outline-none resize-none text-sm leading-relaxed text-slate-900 placeholder:text-slate-300"
              placeholder="Briefly describe your story and what you're hoping to learn from reviewers..."
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-2 py-0.5 rounded">04</span>
            <label className="text-xs font-semibold uppercase tracking-widest text-slate-700">Choose Reviewer</label>
          </div>
          <p className="text-slate-500 text-xs">Select a perspective. You can add more reviewers after seeing your first report.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PERSONAS.map((persona) => {
              const isSelected = selectedPersonaId === persona.id;
              return (
                <button
                  key={persona.id}
                  type="button"
                  onClick={() => setSelectedPersonaId(persona.id)}
                  className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                    isSelected
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <img
                    src={persona.avatar}
                    alt={persona.name}
                    className={`w-10 h-10 rounded-lg object-cover ${isSelected ? '' : 'opacity-70'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-slate-900">{persona.name}</span>
                      {isSelected && (
                        <span className="w-4 h-4 bg-slate-900 rounded-full flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium">{persona.role}</p>
                    {persona.focusAreas && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {persona.focusAreas.map((area, idx) => (
                          <span key={idx} className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                            isSelected ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {area}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-slate-900 text-white px-2 py-0.5 rounded">05</span>
              <label className="text-xs font-semibold uppercase tracking-widest text-slate-700">Your Questions</label>
            </div>
            <button type="button" onClick={addQuestion} className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors">
              + Add question
            </button>
          </div>
          
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2 group">
                <input
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:bg-white outline-none transition-all text-slate-900 placeholder:text-slate-300"
                  placeholder={`What would you like to know?`}
                  value={q}
                  onChange={(e) => updateQuestion(i, e.target.value)}
                />
                {questions.length > 1 && (
                  <button type="button" onClick={() => removeQuestion(i)} className="p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <Button 
          type="submit" 
          className="w-full py-4 rounded-xl text-base font-semibold shadow-lg hover:shadow-xl hover:translate-y-[-2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg disabled:hover:translate-y-0" 
          size="lg"
          disabled={!isFormValid()}
        >
          {isSubmitting ? 'Starting Review...' : 'Start Review'}
        </Button>
      </form>
    </div>
  );
};
