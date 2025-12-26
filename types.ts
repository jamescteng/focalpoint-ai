
export interface Persona {
  id: string;
  name: string;
  role: string;
  description: string;
  instruction: string;
  avatar: string;
  color: string;
  demographics: {
    age: string;
    segment: string;
    tastes: string[];
    background: string;
  };
}

export interface Highlight {
  timestamp: string;
  seconds: number;
  summary: string;
  why_it_works: string;
  category: 'emotion' | 'craft' | 'clarity' | 'marketability';
}

export interface Concern {
  timestamp: string;
  seconds: number;
  issue: string;
  impact: string;
  severity: number;
  category: 'pacing' | 'clarity' | 'character' | 'audio' | 'visual' | 'tone' | 'marketability';
  suggested_fix: string;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface AgentReport {
  personaId: string;
  executive_summary: string;
  highlights: Highlight[];
  concerns: Concern[];
  answers: QuestionAnswer[];
  validationWarnings?: string[];
}

export interface Project {
  id: string;
  title: string;
  synopsis: string;
  srtContent: string;
  videoUrl?: string;
  videoFile?: File;
  questions: string[];
  language: 'en' | 'zh-TW';
}

export enum AppState {
  KEY_SELECTION = 'KEY_SELECTION',
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  VIEWING = 'VIEWING'
}
