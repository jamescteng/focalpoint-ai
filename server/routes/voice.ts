import { Router } from 'express';
import { storage } from '../storage.js';
import { FocalPointLogger } from '../utils/logger.js';
import { statusLimiter } from '../middleware/rateLimiting.js';
import { getPersonaById } from '../personas.js';
import { 
  generateVoiceScript, 
  generateReportHash, 
  getFullTranscript, 
  PersonaReport, 
  PersonaMeta 
} from '../voiceScriptService.js';
import { generateAudio, isLanguageSupported } from '../elevenLabsService.js';

const router = Router();

router.get('/:sessionId/reports/:personaId/voice-script', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    const personaId = req.params.personaId;
    
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const cached = await storage.getVoiceScript(sessionId, personaId);
    if (cached) {
      FocalPointLogger.info("VoiceScript_CacheHit", { sessionId, personaId });
      return res.json({
        script: cached.scriptJson,
        audioUrl: cached.audioUrl,
        transcript: getFullTranscript(cached.scriptJson),
        cached: true
      });
    }
    
    return res.status(404).json({ error: 'Voice script not found. Generate one first.' });
  } catch (error: any) {
    FocalPointLogger.error("VoiceScript_Get", error.message);
    res.status(500).json({ error: 'Failed to retrieve voice script.' });
  }
});

router.post('/:sessionId/reports/:personaId/voice-script', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    const personaId = req.params.personaId;
    
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const reports = await storage.getReportsBySession(sessionId);
    const report = reports.find(r => r.personaId === personaId);
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found for this persona.' });
    }
    
    const session = await storage.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    
    const language = (session.language === 'zh-TW' ? 'zh-TW' : 'en') as 'en' | 'zh-TW';
    
    const personaConfig = getPersonaById(personaId);
    if (!personaConfig) {
      return res.status(400).json({ error: 'Invalid persona ID.' });
    }
    
    const sessionAlias = (session.personaAliases as any[] || []).find(
      (a: any) => a.personaId === personaId
    );
    
    const personaMeta: PersonaMeta = {
      personaId: personaConfig.id,
      name: sessionAlias?.name || personaConfig.name,
      role: sessionAlias?.role || personaConfig.role
    };
    
    const personaReport: PersonaReport = {
      personaId: report.personaId,
      executive_summary: report.executiveSummary,
      highlights: report.highlights as any[],
      concerns: report.concerns as any[],
      answers: report.answers as any[]
    };
    
    const reportHash = generateReportHash(personaReport);
    
    const existingScript = await storage.getVoiceScript(sessionId, personaId);
    if (existingScript && existingScript.reportHash === reportHash) {
      FocalPointLogger.info("VoiceScript_CacheHit", { sessionId, personaId, hash: reportHash });
      return res.json({
        script: existingScript.scriptJson,
        audioUrl: existingScript.audioUrl,
        transcript: getFullTranscript(existingScript.scriptJson),
        cached: true
      });
    }
    
    FocalPointLogger.info("VoiceScript_Generating", { sessionId, personaId, language });
    
    const { script, validation, hash } = await generateVoiceScript(personaMeta, personaReport, language);
    
    if (validation.warnings.length > 0) {
      FocalPointLogger.warn("VoiceScript_Validation", validation.warnings.join('; '));
    }
    
    const savedScript = await storage.createVoiceScript({
      sessionId,
      personaId,
      reportHash: hash,
      language,
      scriptJson: script,
      audioUrl: null
    });
    
    FocalPointLogger.info("VoiceScript_Created", { id: savedScript.id, sessionId, personaId });
    
    res.json({
      script,
      audioUrl: null,
      transcript: getFullTranscript(script),
      cached: false,
      validationWarnings: validation.warnings
    });
  } catch (error: any) {
    FocalPointLogger.error("VoiceScript_Generate", error.message);
    res.status(500).json({ error: 'Failed to generate voice script.' });
  }
});

router.post('/:sessionId/reports/:personaId/voice-audio', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId, 10);
    const personaId = req.params.personaId;
    
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const voiceScript = await storage.getVoiceScript(sessionId, personaId);
    if (!voiceScript) {
      return res.status(404).json({ error: 'Voice script not found. Generate script first.' });
    }
    
    if (voiceScript.audioUrl) {
      FocalPointLogger.info("VoiceAudio_CacheHit", { sessionId, personaId });
      return res.json({
        audioUrl: voiceScript.audioUrl,
        cached: true,
        languageSupported: true
      });
    }
    
    const language = voiceScript.language as 'en' | 'zh-TW';
    
    if (!isLanguageSupported(personaId, language)) {
      return res.json({
        audioUrl: null,
        cached: false,
        languageSupported: false,
        error: `Voice not available for ${language}`
      });
    }
    
    FocalPointLogger.info("VoiceAudio_Generating", { sessionId, personaId, language });
    
    const audioResult = await generateAudio(
      voiceScript.scriptJson,
      sessionId,
      personaId,
      voiceScript.reportHash
    );
    
    if (!audioResult.success) {
      return res.status(500).json({
        error: audioResult.error || 'Audio generation failed',
        languageSupported: audioResult.languageSupported
      });
    }
    
    await storage.updateVoiceScriptAudio(voiceScript.id, audioResult.audioUrl!);
    
    FocalPointLogger.info("VoiceAudio_Created", { sessionId, personaId, audioUrl: audioResult.audioUrl });
    
    res.json({
      audioUrl: audioResult.audioUrl,
      cached: false,
      languageSupported: true
    });
  } catch (error: any) {
    FocalPointLogger.error("VoiceAudio_Generate", error.message);
    res.status(500).json({ error: 'Failed to generate audio.' });
  }
});

router.get('/audio/*splat', statusLimiter, async (req, res) => {
  try {
    const pathParts = req.params.splat as unknown as string[];
    const objectPath = '/objects/' + pathParts.join('/');
    
    const { ObjectStorageService, ObjectNotFoundError } = await import('../replit_integrations/object_storage/objectStorage.js');
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

export default router;
