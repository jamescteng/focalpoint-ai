import { Router } from 'express';
import sessionsRouter from './sessions.js';
import reportsRouter from './reports.js';
import voiceRouter from './voice.js';
import analyzeRouter from './analyze.js';
import questionsRouter from './questions.js';

export {
  sessionsRouter,
  reportsRouter,
  voiceRouter,
  analyzeRouter,
  questionsRouter
};
