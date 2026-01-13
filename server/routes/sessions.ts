import { Router } from 'express';
import { storage } from '../storage.js';
import { FocalPointLogger } from '../utils/logger.js';
import { generatePersonaAliases } from '../utils/personaAliases.js';
import { statusLimiter } from '../middleware/rateLimiting.js';
import { fetchWithTrace } from '../utils/fetchWithTrace.js';
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
    const { title, synopsis, questions, language, fileUri, fileMimeType, fileName, youtubeUrl, youtubeEmbeddable } = req.body;
    
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
      youtubeEmbeddable: youtubeUrl ? (youtubeEmbeddable ?? null) : null,
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
      
      let response: Response;
      try {
        response = await fetchWithTrace(req.requestId, apiUrl, { timeout: 10000 });
      } catch (fetchError: any) {
        FocalPointLogger.error("YouTube_API_Fetch", `[${req.requestId}] Network error: ${fetchError.message || fetchError}`);
        return res.json({ 
          valid: false, 
          error: 'Network error when verifying video. Please try again.',
          requestId: req.requestId
        });
      }
      
      if (!response.ok) {
        FocalPointLogger.warn("YouTube_API", `[${req.requestId}] API returned ${response.status}`);
        return res.json({ 
          valid: false, 
          error: 'Unable to verify video. Please try again.',
          requestId: req.requestId
        });
      }
      
      let data: any;
      try {
        data = await response.json();
      } catch (parseError: any) {
        FocalPointLogger.error("YouTube_API_Parse", `[${req.requestId}] JSON parse error: ${parseError.message}`);
        return res.json({ 
          valid: false, 
          error: 'Failed to parse video data. Please try again.',
          requestId: req.requestId
        });
      }
      
      if (!data.items || data.items.length === 0) {
        return res.json({ 
          valid: false, 
          error: 'This video is private or does not exist. Please use a public YouTube video.',
          privacyStatus: 'private_or_not_found',
          requestId: req.requestId
        });
      }
      
      const video = data.items[0];
      const privacyStatus = video.status?.privacyStatus;
      const title = video.snippet?.title;
      const author = video.snippet?.channelTitle;
      
      if (privacyStatus === 'public') {
        const embeddable = video.status?.embeddable ?? true;
        return res.json({ 
          valid: true, 
          title,
          author,
          privacyStatus: 'public',
          embeddable,
          requestId: req.requestId
        });
      } else if (privacyStatus === 'unlisted') {
        return res.json({ 
          valid: false, 
          error: 'This video is unlisted. Please use a public YouTube video for analysis.',
          privacyStatus: 'unlisted',
          requestId: req.requestId
        });
      } else if (privacyStatus === 'private') {
        return res.json({ 
          valid: false, 
          error: 'This video is private. Please use a public YouTube video.',
          privacyStatus: 'private',
          requestId: req.requestId
        });
      } else {
        return res.json({ 
          valid: false, 
          error: 'Unable to determine video accessibility.',
          requestId: req.requestId
        });
      }
    } else {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
      
      let response: Response;
      try {
        response = await fetchWithTrace(req.requestId, oembedUrl, { timeout: 10000 });
      } catch (fetchError: any) {
        FocalPointLogger.error("YouTube_oEmbed_Fetch", `[${req.requestId}] Network error: ${fetchError.message || fetchError}`);
        return res.json({ 
          valid: false, 
          error: 'Network error when verifying video. Please try again.',
          requestId: req.requestId
        });
      }
      
      if (response.ok) {
        let data: any;
        try {
          data = await response.json();
        } catch (parseError: any) {
          FocalPointLogger.error("YouTube_oEmbed_Parse", `[${req.requestId}] JSON parse error: ${parseError.message}`);
          return res.json({ 
            valid: false, 
            error: 'Failed to parse video data. Please try again.',
            requestId: req.requestId
          });
        }
        return res.json({ 
          valid: true, 
          title: data.title,
          author: data.author_name,
          embeddable: null,
          warning: 'Could not verify if video is public or embeddable. Public videos work best.',
          requestId: req.requestId
        });
      } else if (response.status === 401 || response.status === 403) {
        return res.json({ 
          valid: false, 
          error: 'This video is private. Please use a public YouTube video.',
          requestId: req.requestId 
        });
      } else if (response.status === 404) {
        return res.json({ 
          valid: false, 
          error: 'Video not found. Please check the URL and try again.',
          requestId: req.requestId
        });
      } else {
        return res.json({ 
          valid: false, 
          error: 'Unable to verify video accessibility. Please try again.',
          requestId: req.requestId
        });
      }
    }
  } catch (error: any) {
    FocalPointLogger.error("YouTube_Validate", `[${req.requestId}] ${error.message}`);
    return res.status(500).json({ 
      valid: false, 
      error: 'Failed to validate YouTube URL. Please try again.',
      requestId: req.requestId
    });
  }
});

export default router;
