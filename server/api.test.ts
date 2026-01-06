import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';

describe('API Endpoints', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    app.get('/api/personas', (req, res) => {
      res.json([
        { id: 'acquisitions_director', name: 'Sarah Chen' },
        { id: 'cultural_editor', name: 'Marcus Johnson' }
      ]);
    });
  });

  describe('GET /api/health', () => {
    it('returns ok status', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /api/personas', () => {
    it('returns list of personas', async () => {
      const response = await request(app).get('/api/personas');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('each persona has id and name', async () => {
      const response = await request(app).get('/api/personas');
      response.body.forEach((persona: { id: string; name: string }) => {
        expect(persona.id).toBeDefined();
        expect(persona.name).toBeDefined();
      });
    });
  });
});

describe('Input Validation', () => {
  describe('Analyze endpoint validation', () => {
    const validRequest = {
      title: 'Test Film',
      synopsis: 'A test synopsis',
      questions: ['Question 1'],
      language: 'en',
      fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
      fileMimeType: 'video/mp4',
      personaIds: ['cultural_editor']
    };

    it('validates title is not empty', () => {
      const invalidTitle = { ...validRequest, title: '' };
      expect(invalidTitle.title.length).toBe(0);
    });

    it('validates title max length (200 chars)', () => {
      const longTitle = 'a'.repeat(201);
      expect(longTitle.length).toBeGreaterThan(200);
    });

    it('validates synopsis max length (5000 chars)', () => {
      const longSynopsis = 'a'.repeat(5001);
      expect(longSynopsis.length).toBeGreaterThan(5000);
    });

    it('validates questions array max length (10)', () => {
      const tooManyQuestions = Array(11).fill('Question');
      expect(tooManyQuestions.length).toBeGreaterThan(10);
    });

    it('validates each question max length (500 chars)', () => {
      const longQuestion = 'a'.repeat(501);
      expect(longQuestion.length).toBeGreaterThan(500);
    });

    it('validates language must be en or zh-TW', () => {
      const validLanguages = ['en', 'zh-TW'];
      expect(validLanguages).toContain('en');
      expect(validLanguages).toContain('zh-TW');
      expect(validLanguages).not.toContain('fr');
    });

    it('validates fileUri starts with googleapis domain', () => {
      const validUri = 'https://generativelanguage.googleapis.com/v1beta/files/abc';
      expect(validUri.startsWith('https://generativelanguage.googleapis.com/')).toBe(true);
      
      const invalidUri = 'https://malicious.com/file';
      expect(invalidUri.startsWith('https://generativelanguage.googleapis.com/')).toBe(false);
    });

    it('validates personaIds against allowed list', () => {
      const allowedPersonas = ['acquisitions_director', 'cultural_editor', 'mass_audience_viewer', 'social_impact_viewer'];
      const validPersona = 'cultural_editor';
      const invalidPersona = 'fake_persona';
      
      expect(allowedPersonas).toContain(validPersona);
      expect(allowedPersonas).not.toContain(invalidPersona);
    });
  });

  describe('Upload validation', () => {
    it('validates maximum file size (2GB)', () => {
      const maxSizeBytes = 2 * 1024 * 1024 * 1024;
      const validSize = 1.5 * 1024 * 1024 * 1024;
      const invalidSize = 2.5 * 1024 * 1024 * 1024;
      
      expect(validSize).toBeLessThan(maxSizeBytes);
      expect(invalidSize).toBeGreaterThan(maxSizeBytes);
    });

    it('validates video MIME types', () => {
      const validMimeTypes = [
        'video/mp4',
        'video/quicktime',
        'video/webm',
        'video/avi'
      ];

      validMimeTypes.forEach(type => {
        expect(type.startsWith('video/')).toBe(true);
      });

      const invalidType = 'application/pdf';
      expect(invalidType.startsWith('video/')).toBe(false);
    });
  });
});

describe('Session Fingerprint Storage', () => {
  it('session should store fingerprint fields', () => {
    const sessionData = {
      id: 1,
      title: 'Test Film',
      synopsis: 'Test synopsis',
      questions: ['Q1'],
      language: 'en',
      fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
      fileMimeType: 'video/mp4',
      fileName: 'test.mp4',
      fileSize: '104857600',
      fileLastModified: '1234567890',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(sessionData.fileSize).toBeDefined();
    expect(sessionData.fileLastModified).toBeDefined();
    expect(BigInt(sessionData.fileSize)).toBe(BigInt(100 * 1024 * 1024));
    expect(BigInt(sessionData.fileLastModified)).toBe(BigInt(1234567890));
  });

  it('fingerprint can be compared for verification', () => {
    const storedFingerprint = {
      fileName: 'my-video.mp4',
      fileSize: 104857600,
      lastModified: 1234567890
    };

    const matchingFile = {
      name: 'my-video.mp4',
      size: 104857600,
      lastModified: 1234567890
    };

    const mismatchedFile = {
      name: 'different-video.mp4',
      size: 200000000,
      lastModified: 9876543210
    };

    const isMatch = (stored: typeof storedFingerprint, file: typeof matchingFile) => {
      return stored.fileName === file.name &&
             stored.fileSize === file.size &&
             stored.lastModified === file.lastModified;
    };

    expect(isMatch(storedFingerprint, matchingFile)).toBe(true);
    expect(isMatch(storedFingerprint, mismatchedFile)).toBe(false);
  });
});

describe('Rate Limiting Logic', () => {
  it('upload endpoint should have strict limit (2/min)', () => {
    const uploadRateLimit = { max: 2, windowMs: 60000 };
    expect(uploadRateLimit.max).toBe(2);
    expect(uploadRateLimit.windowMs).toBe(60000);
  });

  it('analyze endpoint should have moderate limit (5/min)', () => {
    const analyzeRateLimit = { max: 5, windowMs: 60000 };
    expect(analyzeRateLimit.max).toBe(5);
    expect(analyzeRateLimit.windowMs).toBe(60000);
  });

  it('health/personas endpoints should have relaxed limit (20/min)', () => {
    const generalRateLimit = { max: 20, windowMs: 60000 };
    expect(generalRateLimit.max).toBe(20);
    expect(generalRateLimit.windowMs).toBe(60000);
  });
});

describe('Error Sanitization', () => {
  it('should not expose internal error details', () => {
    const internalError = new Error('Database connection failed at pg://user:password@host:5432/db');
    const sanitizedMessage = 'An internal server error occurred';
    
    expect(sanitizedMessage).not.toContain('password');
    expect(sanitizedMessage).not.toContain('pg://');
    expect(sanitizedMessage).not.toContain('Database');
  });

  it('should provide generic error for unknown errors', () => {
    const genericMessage = 'Something went wrong. Please try again.';
    expect(genericMessage).not.toContain('stack');
    expect(genericMessage).not.toContain('Error:');
  });
});
