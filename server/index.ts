console.log('[FocalPoint] Server module loading...');

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllPersonas } from './personas.js';
import dialogueRoutes from './dialogueRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import { sessionsRouter, reportsRouter, voiceRouter, analyzeRouter } from './routes/index.js';
import { statusLimiter } from './middleware/rateLimiting.js';
import { FocalPointLogger } from './utils/logger.js';
import { requestIdMiddleware, requestLoggingMiddleware, globalErrorHandler } from './middleware/requestId.js';

console.log('[FocalPoint] All imports successful');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || (isProduction ? 5000 : 3001);
console.log(`[FocalPoint] Configured PORT: ${PORT} (isProduction: ${isProduction}, env.PORT: ${process.env.PORT || 'not set'})`);

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.get('/', (req, res, next) => {
  const acceptHeader = req.get('Accept') || '';
  if (acceptHeader.includes('text/html')) {
    return next();
  }
  res.status(200).send('ok');
});

app.set('trust proxy', 1);

app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

console.log('[FocalPoint] Configuring middleware...');

const allowedOrigins = isProduction
  ? [process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER?.toLowerCase()}.repl.co` : '']
  : ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://0.0.0.0:5000'];

if (isProduction && process.env.REPLIT_DEV_DOMAIN) {
  allowedOrigins.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, !isProduction);
    }
    
    if (origin.endsWith('.repl.co') || origin.endsWith('.replit.dev') || origin.endsWith('.replit.app')) {
      return callback(null, true);
    }
    
    if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(origin)) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    FocalPointLogger.warn('CORS', `Blocked request from origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const jsonParser = express.json({ limit: '50mb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/api/uploads')) {
    return next();
  }
  return jsonParser(req, res, next);
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, '../dist')));
}

app.get('/api/personas', statusLimiter, (req, res) => {
  const personas = getAllPersonas().map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    avatar: p.avatar,
    demographics: p.demographics,
    highlightCategories: p.highlightCategories,
    concernCategories: p.concernCategories
  }));
  res.json(personas);
});

app.use('/api/dialogue', dialogueRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', reportsRouter);
app.use('/api/sessions', voiceRouter);
app.use('/api/analyze', analyzeRouter);

app.get('/api/voice-audio/*splat', statusLimiter, async (req, res) => {
  try {
    const pathParts = req.params.splat as unknown as string[];
    const objectPath = '/objects/' + pathParts.join('/');
    
    const { ObjectStorageService, ObjectNotFoundError } = await import('./replit_integrations/object_storage/objectStorage.js');
    const objectStorage = new ObjectStorageService();
    
    try {
      const file = await objectStorage.getObjectEntityFile(objectPath);
      await objectStorage.downloadObject(file, res, 86400);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: 'Audio file not found.' });
      }
      throw error;
    }
  } catch (error: any) {
    FocalPointLogger.error("VoiceAudio_Serve", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve audio.' });
    }
  }
});

if (isProduction) {
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

app.use(globalErrorHandler);

process.on('uncaughtException', (error) => {
  console.error('[FocalPoint][FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FocalPoint][FATAL] Unhandled Rejection:', reason);
});

process.on('exit', (code) => {
  console.error(`[FocalPoint][EXIT] Process exiting with code: ${code}`);
});

console.log('[FocalPoint] Starting server...');
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FocalPoint] Backend server running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('[FocalPoint][FATAL] Server error:', err);
});

const gracefulShutdown = (signal: string) => {
  console.log(`[FocalPoint] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('[FocalPoint] Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[FocalPoint] Forcing shutdown after timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

console.log('[FocalPoint] Server setup complete, waiting for listen callback...');
