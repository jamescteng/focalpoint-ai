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

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

function isValidYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

router.post('/', statusLimiter, async (req, res) => {
  try {
    const { title, synopsis, questions, language, fileUri, fileMimeType, fileName, youtubeUrl } = req.body;
    
    if (!title || typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: 'Invalid title.' });
    }
    
    if (youtubeUrl && !isValidYoutubeUrl(youtubeUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube URL format.' });
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
      youtubeUrl: youtubeUrl || null,
      personaAliases,
    });
    
    FocalPointLogger.info("Session_Created", { sessionId: session.id, isYoutube: !!youtubeUrl });
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

router.post('/validate-youtube', statusLimiter, async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    
    if (!youtubeUrl || typeof youtubeUrl !== 'string') {
      return res.status(400).json({ valid: false, error: 'YouTube URL is required.' });
    }
    
    if (!isValidYoutubeUrl(youtubeUrl)) {
      return res.status(400).json({ valid: false, error: 'Invalid YouTube URL format.' });
    }
    
    const videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({ valid: false, error: 'Could not extract video ID from URL.' });
    }
    
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    
    if (youtubeApiKey) {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${videoId}&key=${youtubeApiKey}`;
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        FocalPointLogger.warn("YouTube_API", `API returned ${response.status}`);
        return res.json({ 
          valid: false, 
          error: 'Unable to verify video. Please try again.' 
        });
      }
      
      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        return res.json({ 
          valid: false, 
          error: 'This video is private or does not exist. Please use a public YouTube video.',
          privacyStatus: 'private_or_not_found'
        });
      }
      
      const video = data.items[0];
      const privacyStatus = video.status?.privacyStatus;
      const title = video.snippet?.title;
      const author = video.snippet?.channelTitle;
      
      if (privacyStatus === 'public') {
        return res.json({ 
          valid: true, 
          title,
          author,
          privacyStatus: 'public'
        });
      } else if (privacyStatus === 'unlisted') {
        return res.json({ 
          valid: false, 
          error: 'This video is unlisted. Please use a public YouTube video for analysis.',
          privacyStatus: 'unlisted'
        });
      } else if (privacyStatus === 'private') {
        return res.json({ 
          valid: false, 
          error: 'This video is private. Please use a public YouTube video.',
          privacyStatus: 'private'
        });
      } else {
        return res.json({ 
          valid: false, 
          error: 'Unable to determine video accessibility.' 
        });
      }
    } else {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
      const response = await fetch(oembedUrl);
      
      if (response.ok) {
        const data = await response.json();
        return res.json({ 
          valid: true, 
          title: data.title,
          author: data.author_name,
          warning: 'Could not verify if video is public. Public videos work best.'
        });
      } else if (response.status === 401 || response.status === 403) {
        return res.json({ 
          valid: false, 
          error: 'This video is private. Please use a public YouTube video.' 
        });
      } else if (response.status === 404) {
        return res.json({ 
          valid: false, 
          error: 'Video not found. Please check the URL and try again.' 
        });
      } else {
        return res.json({ 
          valid: false, 
          error: 'Unable to verify video accessibility. Please try again.' 
        });
      }
    }
  } catch (error: any) {
    FocalPointLogger.error("YouTube_Validate", error.message);
    return res.status(500).json({ 
      valid: false, 
      error: 'Failed to validate YouTube URL. Please try again.' 
    });
  }
});

export default router;
