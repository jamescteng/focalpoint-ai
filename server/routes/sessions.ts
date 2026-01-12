import { Router } from 'express';
import { storage } from '../storage.js';
import { FocalPointLogger } from '../utils/logger.js';
import { generatePersonaAliases } from '../utils/personaAliases.js';
import { statusLimiter } from '../middleware/rateLimiting.js';
import { 
  MAX_TITLE_LENGTH, 
  MAX_QUESTIONS_COUNT, 
  VALID_LANGUAGES 
} from '../middleware/validation.js';

const router = Router();

router.post('/', statusLimiter, async (req, res) => {
  try {
    const { title, synopsis, questions, language, fileUri, fileMimeType, fileName } = req.body;
    
    if (!title || typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: 'Invalid title.' });
    }
    
    const personaAliases = generatePersonaAliases();
    
    const session = await storage.createSession({
      title: title.trim(),
      synopsis: synopsis?.trim() || '',
      questions: Array.isArray(questions) ? questions.slice(0, MAX_QUESTIONS_COUNT) : [],
      language: VALID_LANGUAGES.includes(language) ? language : 'en',
      fileUri: fileUri || null,
      fileMimeType: fileMimeType || null,
      fileName: fileName || null,
      personaAliases,
    });
    
    FocalPointLogger.info("Session_Created", { sessionId: session.id });
    res.json(session);
  } catch (error: any) {
    FocalPointLogger.error("Session_Create", error.message);
    res.status(500).json({ error: 'Failed to create session.' });
  }
});

router.get('/', statusLimiter, async (req, res) => {
  try {
    const sessions = await storage.getSessions();
    res.json(sessions);
  } catch (error: any) {
    FocalPointLogger.error("Sessions_List", error.message);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

router.get('/:id', statusLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const session = await storage.getSession(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    
    res.json(session);
  } catch (error: any) {
    FocalPointLogger.error("Session_Get", error.message);
    res.status(500).json({ error: 'Failed to load session.' });
  }
});

router.put('/:id', statusLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const { fileUri, fileMimeType, fileName } = req.body;
    
    const session = await storage.updateSession(id, {
      fileUri,
      fileMimeType,
      fileName,
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    
    FocalPointLogger.info("Session_Updated", { sessionId: session.id });
    res.json(session);
  } catch (error: any) {
    FocalPointLogger.error("Session_Update", error.message);
    res.status(500).json({ error: 'Failed to update session.' });
  }
});

router.delete('/:id', statusLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    await storage.deleteSession(id);
    FocalPointLogger.info("Session_Deleted", { sessionId: id });
    res.json({ success: true });
  } catch (error: any) {
    FocalPointLogger.error("Session_Delete", error.message);
    res.status(500).json({ error: 'Failed to delete session.' });
  }
});

export default router;
