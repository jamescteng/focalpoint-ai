import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getExternalDomain } from './domainUtils';

describe('getExternalDomain', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockRequest(options: {
    forwardedHost?: string;
    host?: string;
    hostname?: string;
  }) {
    return {
      get: (header: string) => {
        if (header === 'x-forwarded-host') return options.forwardedHost;
        if (header === 'host') return options.host;
        return undefined;
      },
      hostname: options.hostname || 'localhost',
    };
  }

  it('should prioritize REPLIT_DEV_DOMAIN when set', () => {
    process.env.REPLIT_DEV_DOMAIN = 'my-app.pike.replit.dev';
    const req = mockRequest({
      forwardedHost: 'other.domain.com',
      host: 'localhost:3001',
      hostname: 'localhost',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('my-app.pike.replit.dev');
  });

  it('should use x-forwarded-host when REPLIT_DEV_DOMAIN is not set', () => {
    delete process.env.REPLIT_DEV_DOMAIN;
    const req = mockRequest({
      forwardedHost: 'my-app.replit.app',
      host: 'localhost:3001',
      hostname: 'localhost',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('my-app.replit.app');
  });

  it('should extract first host from comma-separated x-forwarded-host', () => {
    delete process.env.REPLIT_DEV_DOMAIN;
    const req = mockRequest({
      forwardedHost: 'primary.com, secondary.com, third.com',
      host: 'localhost:3001',
      hostname: 'localhost',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('primary.com');
  });

  it('should use host header (without port) when no forwarded host', () => {
    delete process.env.REPLIT_DEV_DOMAIN;
    const req = mockRequest({
      host: 'my-app.replit.app:443',
      hostname: 'localhost',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('my-app.replit.app');
  });

  it('should use host header without port when port is 5000', () => {
    delete process.env.REPLIT_DEV_DOMAIN;
    const req = mockRequest({
      host: 'example.com:5000',
      hostname: 'localhost',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('example.com');
  });

  it('should fall back to req.hostname as last resort', () => {
    delete process.env.REPLIT_DEV_DOMAIN;
    const req = mockRequest({
      hostname: 'fallback.example.com',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('fallback.example.com');
  });

  it('should handle host header without port', () => {
    delete process.env.REPLIT_DEV_DOMAIN;
    const req = mockRequest({
      host: 'simple-host.com',
      hostname: 'localhost',
    });

    const result = getExternalDomain(req);

    expect(result).toBe('simple-host.com');
  });
});
