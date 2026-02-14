# FocalPoint AI

## Overview
AI focus group platform for indie filmmakers. Gemini AI analyzes videos through four distinct personas, providing timestamped feedback, voice notes, and podcast dialogues.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Vite (port 5000), Tailwind CSS
- **Backend**: Express (port 3001), proxied via Vite `/api`
- **AI**: Google Gemini (`gemini-3-flash-preview`, `MEDIA_RESOLUTION_LOW` for ~171min max)
- **TTS**: ElevenLabs (`eleven_v3` EN, `eleven_multilingual_v2` zh-TW)
- **Database**: PostgreSQL + Drizzle ORM
- **Storage**: Replit Object Storage

## Key Files

### Server
| File | Purpose |
|------|---------|
| `server/index.ts` | Express entry, middleware, route mounting |
| `server/routes/` | sessions, reports, voice, analyze endpoints |
| `server/uploadRoutes.ts` | Upload flow + Gemini file transfer |
| `server/dialogueRoutes.ts` | Podcast generation endpoints |
| `server/middleware/rateLimiting.ts` | Rate limit configs |
| `server/services/videoCompressor.ts` | FFmpeg 720p/2fps compression |
| `server/services/compressionDecider.ts` | Smart compression decision logic (TDD) |
| `server/services/progressManager.ts` | Resilient DB updates with retry, throttling, milestones |
| `server/services/cacheService.ts` | Global Gemini context cache lifecycle (create, reuse, delete) |
| `server/personas.ts` | AI persona definitions |
| `server/geminiService.ts` | Gemini API wrapper |
| `server/elevenLabsService.ts` | TTS integration |

### Frontend
| File | Purpose |
|------|---------|
| `components/ScreeningRoom.tsx` | Main session view |
| `components/UploadForm.tsx` | Video upload + metadata |
| `components/VoicePlayer.tsx` | Voice note playback |
| `components/DialoguePlayer.tsx` | Podcast playback |
| `src/i18n.ts` | i18n config (default: zh-TW) |
| `src/locales/` | zh-TW (default) + EN translations |

### Shared
| File | Purpose |
|------|---------|
| `shared/schema.ts` | Drizzle database schema |
| `geminiService.ts` | Frontend Gemini client |

## Progress Tracking
Progress bar ranges (monotonic, never goes backward):
- **Upload**: 0-5% (file upload to server)
- **Gemini Transfer**: 5-85% (direct upload to Gemini API via 32MB chunks)
- **AI Processing**: 85-100% (analysis by persona)
- **YouTube path**: Jumps to 85% (skips upload)

Note: Compression is disabled - files upload directly to Gemini for faster processing.

Server: `ProgressFlushManager` tracks `maxSeenPct` to reject backward updates.
Frontend: All `setProcessProgress` calls use `Math.max(prev, X)` pattern.

## Fire-and-Forget Analysis Pattern
Analysis uses an async job pattern for mobile resilience (screen locks, app switches):

1. **POST /api/analyze** - Returns `{ jobIds: string[], status: 'pending' }` immediately
2. **Background processing** - Server runs AI analysis asynchronously, updates `analysis_jobs` table
3. **GET /api/analyze/status/:jobId** - Frontend polls for completion (2s intervals, 15min timeout)
4. **GET /api/analyze/status/session/:sessionId** - Get all jobs for a session

Job statuses: `pending` → `processing` → `completed` | `failed`

Database table: `analysis_jobs` (jobId, sessionId, personaId, status, result, lastError, createdAt, completedAt)

## Global Context Cache
Uploaded videos get a single Gemini context cache shared across all persona analyses + grounding passes (up to 8 API calls at 90% token discount).

**Architecture**:
- `POST /api/analyze` creates cache once via `ensureVideoCache()` before launching jobs
- `cacheName` passed to all `processAnalysisJob` calls
- Cache cleaned up via `Promise.allSettled()` after all jobs complete
- Cache TTL: 900s (15 min), safety margin: 60s for expiry checks
- DB tracking: `uploads` table stores cacheName, cacheModel, cacheStatus, cacheExpiresAt
- YouTube limitation: No cache (context caching doesn't support YouTube URLs)
- `cacheService.ts`: `ensureVideoCache()`, `deleteVideoCache()`, `findUploadIdByFileUri()`

## Timestamp Grounding (Search-not-Verify)
Two-pass system to improve timestamp accuracy, using Search-not-Verify to avoid confirmation bias:

**Pass 1 (Analysis)**: Gemini analyzes the video with `callGeminiWithFallback()` (uses cache when available).

**Pass 2 (Grounding Search)**: Strips timestamps from prompt. Forces AI to independently locate each moment by description + visual/audio clue. Confidence computed from delta between Pass 1 and Pass 2 results:
- delta ≤ 10s → high confidence (timestamp kept)
- delta ≤ 30s → medium confidence (timestamp corrected)
- delta > 30s → low confidence (timestamp corrected, shown dimmed)

**Architecture**:
- Uses the same global cache as Pass 1 (no separate cache creation)
- YouTube: Falls back to direct call (no cache)
- Non-blocking: if grounding fails, Pass 1 results used as-is
- Frontend: Low-confidence timestamps show dimmed with `~` suffix
- Logs: `Grounding_Cached`, `Grounding_Direct`, `Grounding_Complete`, `Grounding_Failed`

## API Resilience
- **Retry logic**: `withRetries()` in analyze.ts - exponential backoff (250ms→5s cap, max 4 attempts, ±10% jitter)
- **API timeout**: 120 seconds per request via `withTimeout()` wrapper - prevents hanging connections
- **Transient error detection**: HTTP 429/500/502/503/504, network codes (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND), timeouts
- **Model fallback**: Primary `gemini-3-flash-preview` → fallback `gemini-2.5-flash` on transient errors after retries exhausted
- **Cache-expiry fallback**: `isCacheError()` detects expired/invalid cache → retries without cached content automatically
- **Upload timeout**: 40 minutes for frontend polling
- **Gemini processing timeout**: 22.5 minutes (90 attempts × 15s) for file to become ACTIVE
- **Analysis timeout**: 15 minutes for frontend polling of analysis jobs

## Observability (Blank Screen Diagnostics)
Layered beacon system to diagnose loading failures:

**Beacon Events** (logged via `/api/beacon`):
- `html_loaded` - Inline script ran (proves HTML reached browser)
- `js_loaded` - Main JS bundle loaded
- `react_mounted` - React successfully rendered
- `runtime_error` - JavaScript error caught
- `unhandled_rejection` - Promise rejection caught
- `mount_timeout` - React didn't mount within 8 seconds

**Diagnostic Flow**:
- No server logs → User can't reach server (network/DNS)
- Server logs but no `html_loaded` → HTML didn't load
- `html_loaded` but no `js_loaded` → JS bundle blocked/failed
- `js_loaded` but no `react_mounted` → React crashed
- `react_mounted` but blank → CSS/routing issue

**Endpoints**:
- `GET /healthz` - Plain text health check (no React)
- `POST /api/beacon` - Frontend event logging

## Security
- Rate limiting: voice/podcast 1/min, polling 20/min
- Error sanitization: generic client messages, detailed server logs
- Input validation on all endpoints

## Secrets
`GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `ELEVENLABS_API_KEY`

## Commands
```bash
npm run dev          # Start dev server
npm run db:push      # Sync database schema
npm run db:studio    # Open Drizzle Studio
```
