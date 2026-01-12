import { Router } from 'express';
import { storage } from '../storage.js';
import { FocalPointLogger } from '../utils/logger.js';
import { statusLimiter } from '../middleware/rateLimiting.js';

const router = Router();

router.get('/:id/reports', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const reports = await storage.getReportsBySession(sessionId);
    res.json(reports);
  } catch (error: any) {
    FocalPointLogger.error("Reports_List", error.message);
    res.status(500).json({ error: 'Failed to load reports.' });
  }
});

router.post('/:id/reports', statusLimiter, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    
    const { personaId, executiveSummary, highlights, concerns, answers, validationWarnings } = req.body;
    
    if (!personaId || !executiveSummary) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    
    const report = await storage.createReport({
      sessionId,
      personaId,
      executiveSummary,
      highlights: highlights || [],
      concerns: concerns || [],
      answers: answers || [],
      validationWarnings: validationWarnings || [],
    });
    
    FocalPointLogger.info("Report_Created", { reportId: report.id, sessionId, personaId });
    res.json(report);
  } catch (error: any) {
    FocalPointLogger.error("Report_Create", error.message);
    res.status(500).json({ error: 'Failed to save report.' });
  }
});

export default router;
