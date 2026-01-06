import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = global.fetch;

describe('geminiService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('uploadVideo', () => {
    it('rejects files larger than 2GB', async () => {
      const { uploadVideo } = await import('../geminiService');
      
      const largeFile = new File(['x'], 'large.mp4', { type: 'video/mp4' });
      Object.defineProperty(largeFile, 'size', { value: 2.5 * 1024 * 1024 * 1024 });

      await expect(uploadVideo(largeFile)).rejects.toThrow(/too large/i);
    });

    it('initiates upload and polls for completion', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ jobId: 'job123', status: 'RECEIVED' }))
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({
            jobId: 'job123',
            status: 'UPLOADING',
            progress: 50,
            fileUri: null,
            fileMimeType: null,
            fileName: null,
            error: null
          }))
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({
            jobId: 'job123',
            status: 'ACTIVE',
            progress: 100,
            fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
            fileMimeType: 'video/mp4',
            fileName: 'files/abc123',
            error: null
          }))
        });

      const { uploadVideo } = await import('../geminiService');
      
      const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });

      const onProgress = vi.fn();
      const result = await uploadVideo(file, onProgress);

      expect(result).toEqual({
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
        fileMimeType: 'video/mp4',
        fileName: 'files/abc123'
      });
      expect(onProgress).toHaveBeenCalled();
    });

    it('throws error when upload fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          text: () => Promise.resolve(JSON.stringify({ error: 'Upload failed' }))
        });

      const { uploadVideo } = await import('../geminiService');
      
      const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });

      await expect(uploadVideo(file)).rejects.toThrow('Upload failed');
    });

    it('handles polling error status', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ jobId: 'job123', status: 'RECEIVED' }))
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({
            jobId: 'job123',
            status: 'ERROR',
            progress: 0,
            fileUri: null,
            fileMimeType: null,
            fileName: null,
            error: 'Processing failed'
          }))
        });

      const { uploadVideo } = await import('../geminiService');
      
      const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });

      await expect(uploadVideo(file)).rejects.toThrow('Processing failed');
    });

    it('handles empty server response', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('')
        });

      const { uploadVideo } = await import('../geminiService');
      
      const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });

      await expect(uploadVideo(file)).rejects.toThrow(/empty response/i);
    });
  });

  describe('analyzeWithPersona', () => {
    it('throws error when title is empty', async () => {
      const { analyzeWithPersona } = await import('../geminiService');
      
      const project = {
        id: '123',
        title: '',
        synopsis: 'test',
        questions: [],
        language: 'en' as const,
        selectedPersonaIds: ['cultural_editor']
      };

      const uploadResult = {
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
        fileMimeType: 'video/mp4',
        fileName: 'files/abc'
      };

      await expect(analyzeWithPersona(project, uploadResult, 'cultural_editor'))
        .rejects.toThrow(/DATA_ERR_01/);
    });

    it('throws error when fileUri is missing', async () => {
      const { analyzeWithPersona } = await import('../geminiService');
      
      const project = {
        id: '123',
        title: 'Test Movie',
        synopsis: 'test',
        questions: [],
        language: 'en' as const,
        selectedPersonaIds: ['cultural_editor']
      };

      const uploadResult = {
        fileUri: '',
        fileMimeType: 'video/mp4',
        fileName: 'files/abc'
      };

      await expect(analyzeWithPersona(project, uploadResult, 'cultural_editor'))
        .rejects.toThrow(/DATA_ERR_02/);
    });

    it('sends correct request body to analyze endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          results: [{
            personaId: 'cultural_editor',
            status: 'success',
            report: {
              executive_summary: 'Test summary',
              highlights: [],
              concerns: [],
              answers: []
            }
          }]
        }))
      });

      const { analyzeWithPersona } = await import('../geminiService');
      
      const project = {
        id: '123',
        title: 'Test Movie',
        synopsis: 'A test synopsis',
        srtContent: 'test srt',
        questions: ['Question 1'],
        language: 'en' as const,
        selectedPersonaIds: ['cultural_editor']
      };

      const uploadResult = {
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
        fileMimeType: 'video/mp4',
        fileName: 'files/abc'
      };

      await analyzeWithPersona(project, uploadResult, 'cultural_editor');

      expect(global.fetch).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Movie',
          synopsis: 'A test synopsis',
          srtContent: 'test srt',
          questions: ['Question 1'],
          language: 'en',
          fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
          fileMimeType: 'video/mp4',
          personaIds: ['cultural_editor']
        })
      }));
    });

    it('returns report on successful analysis', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          results: [{
            personaId: 'cultural_editor',
            status: 'success',
            report: {
              executive_summary: 'Great film!',
              highlights: [{ timestamp: '01:00', seconds: 60, summary: 'Good', why_it_works: 'Yes', category: 'emotion' }],
              concerns: [],
              answers: [{ question: 'Q1', answer: 'A1' }]
            }
          }]
        }))
      });

      const { analyzeWithPersona } = await import('../geminiService');
      
      const project = {
        id: '123',
        title: 'Test Movie',
        synopsis: 'test',
        questions: ['Q1'],
        language: 'en' as const,
        selectedPersonaIds: ['cultural_editor']
      };

      const uploadResult = {
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
        fileMimeType: 'video/mp4',
        fileName: 'files/abc'
      };

      const result = await analyzeWithPersona(project, uploadResult, 'cultural_editor');

      expect(result.personaId).toBe('cultural_editor');
      expect(result.executive_summary).toBe('Great film!');
      expect(result.highlights).toHaveLength(1);
      expect(result.answers).toHaveLength(1);
    });

    it('handles server error response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve(JSON.stringify({ error: 'Server error' }))
      });

      const { analyzeWithPersona } = await import('../geminiService');
      
      const project = {
        id: '123',
        title: 'Test Movie',
        synopsis: 'test',
        questions: [],
        language: 'en' as const,
        selectedPersonaIds: ['cultural_editor']
      };

      const uploadResult = {
        fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
        fileMimeType: 'video/mp4',
        fileName: 'files/abc'
      };

      await expect(analyzeWithPersona(project, uploadResult, 'cultural_editor'))
        .rejects.toThrow('Server error');
    });
  });

  describe('session API functions', () => {
    it('createSession sends correct data', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 1, title: 'Test' }))
      });

      const { createSession } = await import('../geminiService');
      
      const result = await createSession({
        title: 'Test Film',
        synopsis: 'A test',
        questions: ['Q1'],
        language: 'en'
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }));
      expect(result).toEqual({ id: 1, title: 'Test' });
    });

    it('getSessions returns array of sessions', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([
          { id: 1, title: 'Film 1' },
          { id: 2, title: 'Film 2' }
        ]))
      });

      const { getSessions } = await import('../geminiService');
      
      const result = await getSessions();

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Film 1');
    });

    it('updateSession sends PUT request with data', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 1, fileUri: 'test-uri' }))
      });

      const { updateSession } = await import('../geminiService');
      
      await updateSession(1, {
        fileUri: 'test-uri',
        fileMimeType: 'video/mp4',
        fileName: 'test.mp4',
        fileSize: 1000000,
        fileLastModified: 1234567890
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions/1', expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('fileUri')
      }));
    });

    it('saveReport sends report data to correct endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 1 }))
      });

      const { saveReport } = await import('../geminiService');
      
      const report = {
        personaId: 'cultural_editor',
        executive_summary: 'Test',
        highlights: [],
        concerns: [],
        answers: []
      };

      await saveReport(1, report);

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions/1/reports', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId: 'cultural_editor',
          executiveSummary: 'Test',
          highlights: [],
          concerns: [],
          answers: [],
          validationWarnings: [],
        })
      }));
    });

    it('getReportsBySession fetches reports for session', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([
          { id: 1, personaId: 'cultural_editor', executive_summary: 'Test' }
        ]))
      });

      const { getReportsBySession } = await import('../geminiService');
      
      const result = await getReportsBySession(1);

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions/1/reports');
      expect(result).toHaveLength(1);
    });
  });
});
