import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-api-key';

jest.setTimeout(30000);
