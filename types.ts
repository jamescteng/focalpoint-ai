
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
  type: 'highlight' | 'lowlight';
  comment: string;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface AgentReport {
  personaId: string;
  summary: string;
  highlights: Highlight[];
  answers: QuestionAnswer[];
}

export interface Project {
  id: string;
  title: string;
  synopsis: string;
  srtContent: string;
  videoUrl?: string;
  videoFile?: File;
  questions: string[];
}

export enum AppState {
  KEY_SELECTION = 'KEY_SELECTION',
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  VIEWING = 'VIEWING'
}
