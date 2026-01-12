import rateLimit from 'express-rate-limit';

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 2, // 2 uploads per minute per IP
  message: { error: 'Too many upload requests. Please wait before uploading again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 analyze requests per minute per IP
  message: { error: 'Too many analysis requests. Please wait before analyzing again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 status/poll requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadStatusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 status polls per minute per IP (polling every 1.5s = 40/min)
  message: { error: 'Too many status requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadLimiterByAttemptId = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 uploads per attemptId per minute (allows retries)
  keyGenerator: (req) => {
    const attemptId = req.headers['x-upload-attempt-id'] as string;
    return attemptId ? `upload:${attemptId}` : `upload:fallback:${req.ip || 'unknown'}`;
  },
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
