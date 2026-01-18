import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  const clientIp = req.headers['x-forwarded-for'] as string || 
                   req.headers['x-real-ip'] as string || 
                   req.socket.remoteAddress || 
                   'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  console.log(`[${req.requestId}] --> ${req.method} ${req.path} | IP: ${clientIp} | UA: ${userAgent.substring(0, 100)}`);
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${req.requestId}] <-- ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if ('cause' in err && err.cause) {
      serialized.cause = serializeError(err.cause);
    }
    if ('code' in err) {
      serialized.code = (err as NodeJS.ErrnoException).code;
    }
    return serialized;
  }
  return { value: String(err) };
}

export function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId || 'unknown';
  
  console.error(`[${requestId}] Unhandled error:`, serializeError(err));
  
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      requestId,
    });
  }
}
