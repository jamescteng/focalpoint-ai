export const VALID_LANGUAGES = ['en', 'zh-TW'] as const;
export type ValidLanguage = typeof VALID_LANGUAGES[number];

export const MAX_TITLE_LENGTH = 200;
export const MAX_SYNOPSIS_LENGTH = 5000;
export const MAX_SRT_LENGTH = 500000; // 500KB
export const MAX_QUESTION_LENGTH = 500;
export const MAX_QUESTIONS_COUNT = 10;
export const MAX_VIDEO_SIZE_MB = 2000;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

export const ALLOWED_VIDEO_MIMES = [
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/mpeg', 'video/ogg', 'video/3gpp', 'video/3gpp2'
];

export function isValidLanguage(lang: unknown): lang is ValidLanguage {
  return typeof lang === 'string' && VALID_LANGUAGES.includes(lang as ValidLanguage);
}

export function validateTitle(title: unknown): string | null {
  if (typeof title !== 'string' || !title.trim()) {
    return 'Title is required';
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `Title exceeds maximum length of ${MAX_TITLE_LENGTH} characters`;
  }
  return null;
}

export function validateSynopsis(synopsis: unknown): string | null {
  if (typeof synopsis !== 'string') {
    return 'Synopsis must be a string';
  }
  if (synopsis.length > MAX_SYNOPSIS_LENGTH) {
    return `Synopsis exceeds maximum length of ${MAX_SYNOPSIS_LENGTH} characters`;
  }
  return null;
}

export function validateQuestions(questions: unknown): string | null {
  if (!Array.isArray(questions)) {
    return 'Questions must be an array';
  }
  if (questions.length > MAX_QUESTIONS_COUNT) {
    return `Maximum ${MAX_QUESTIONS_COUNT} questions allowed`;
  }
  for (const q of questions) {
    if (typeof q !== 'string') {
      return 'Each question must be a string';
    }
    if (q.length > MAX_QUESTION_LENGTH) {
      return `Question exceeds maximum length of ${MAX_QUESTION_LENGTH} characters`;
    }
  }
  return null;
}

export function validateVideoMime(mimeType: string): boolean {
  return ALLOWED_VIDEO_MIMES.includes(mimeType);
}
