# Architecture

## System Flow

```
Browser (React/Vite:5000) ──proxy──> Express:3001 ──> Gemini AI
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ↓                     ↓                     ↓
              PostgreSQL          Object Storage          ElevenLabs
```

## Frontend

**Port 5000** - React 19 + TypeScript + Vite + Tailwind

| Component | Purpose |
|-----------|---------|
| `UploadForm` | Video upload or YouTube URL input with metadata |
| `ScreeningRoom` | Session view with video player, reports, tabs |
| `VoicePlayer` | Audio playback for voice notes |
| `DialoguePlayer` | Podcast conversation playback |

**i18n**: Full English/zh-TW support via i18next. Personas, UI labels, and reports all translated.

## Backend

**Port 3001** - Express with modular routes

| Route | Function |
|-------|----------|
| `/api/uploads/*` | Upload init, presigned URLs, compression, Gemini transfer |
| `/api/analyze` | Fire-and-forget analysis with global cache + grounding |
| `/api/analyze/status/:jobId` | Poll individual job status |
| `/api/analyze/status/session/:sessionId` | Poll all jobs for a session |
| `/api/sessions/*` | CRUD for sessions and reports |
| `/api/voice/*` | Voice script generation + ElevenLabs TTS |
| `/api/dialogue/*` | Podcast job creation and polling |
| `/api/personas` | List available personas |

| Service | Purpose |
|---------|---------|
| `cacheService.ts` | Global Gemini context cache lifecycle (create, reuse, delete) |
| `videoCompressor.ts` | FFmpeg 720p/2fps compression |
| `compressionDecider.ts` | Smart compression decision logic |
| `progressManager.ts` | Resilient DB progress updates with retry, throttling, milestones |

**Security**: Rate limiting (1/min voice, 1/min podcast, 20/min polling), sanitized errors.

## Data Flow

### Upload → Analysis
1. Browser uploads to Object Storage via presigned URL
2. Server probes video metadata (size, resolution, fps)
3. **Smart Compression Decision**:
   - Skip compression if: file ≤100MB AND resolution ≤720p AND fps ≤10
   - Otherwise: compress to 720p/2fps proxy (~85% size reduction)
4. File (original or proxy) transferred to Gemini Files API
5. `POST /api/analyze` creates a global context cache for the video, then launches jobs

### YouTube → Analysis
1. URL validated via YouTube Data API v3
2. Gemini analyzes directly from YouTube URL (no cache — context caching doesn't support YouTube URLs)
3. No upload/compression needed

### Fire-and-Forget Analysis Pattern
Mobile-resilient async job pattern:
1. `POST /api/analyze` returns `{ jobIds, status: 'pending' }` immediately
2. Server creates global Gemini context cache (uploaded files only)
3. Background jobs run analysis per persona with shared cache
4. Each analysis followed by Search-not-Verify grounding pass
5. Frontend polls `GET /api/analyze/status/:jobId` (2s intervals, 15min timeout)
6. Cache cleaned up via `Promise.allSettled()` after all jobs complete

### Global Context Cache
- Single cache per video, shared across all persona analyses + grounding passes (up to 8 API calls)
- 90% token cost reduction vs. sending video in each request
- Cache TTL: 900s (15 min), safety margin: 60s for expiry checks
- DB tracking in `uploads` table: cacheName, cacheModel, cacheStatus, cacheExpiresAt
- Cache-expiry fallback: if cached request fails, retries without cache automatically
- YouTube limitation: no cache support, falls back to direct calls

### Timestamp Grounding (Search-not-Verify)
Two-pass system to improve timestamp accuracy:

**Pass 1 (Analysis)**: Gemini analyzes video with `callGeminiWithFallback()` (uses cache when available).

**Pass 2 (Grounding Search)**: Strips timestamps from prompt. Forces AI to independently locate each moment by description + visual/audio clue. Avoids confirmation bias.

Confidence from delta between Pass 1 and Pass 2:
- ≤10s → high confidence (timestamp kept)
- ≤30s → medium confidence (timestamp corrected)
- \>30s → low confidence (timestamp corrected, shown dimmed in UI)

### Voice Notes
1. Report → structured script → LLM naturalizes prose
2. ElevenLabs TTS → audio file → Object Storage
3. Cached in `voice_scripts` table

### Podcast Dialogue
1. Select two personas → generate debate script
2. ElevenLabs conversational API → dual-voice audio
3. Stored in `dialogue_jobs` table (English only)

## API Resilience

- **Retry logic**: `withRetries()` — exponential backoff (250ms→5s cap, max 4 attempts, ±10% jitter)
- **API timeout**: 120 seconds per request via `withTimeout()` wrapper
- **Transient error detection**: HTTP 429/500/502/503/504, network codes (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND), timeouts
- **Model fallback**: Primary `gemini-3-flash-preview` → fallback `gemini-2.5-flash` on transient errors after retries
- **Cache-expiry fallback**: `isCacheError()` detects expired/invalid cache → retries without cached content
- **Upload timeout**: 40 minutes for frontend polling
- **Gemini processing timeout**: 22.5 minutes for file to become ACTIVE
- **Analysis timeout**: 15 minutes for frontend polling of analysis jobs

## Database Schema

| Table | Purpose |
|-------|---------|
| `sessions` | Video metadata, questions, language preference |
| `reports` | AI analysis results per persona |
| `analysis_jobs` | Async analysis job state (pending → processing → completed/failed) |
| `voice_scripts` | Cached voice scripts + audio URLs |
| `dialogue_jobs` | Podcast generation state machine |
| `uploads` | Upload progress tracking + Gemini cache metadata |

## Personas

Four distinct reviewer perspectives, each with unique voice/demographics:
- **Acquisitions Director** - Industry veteran, commercial focus
- **Cultural Editor** - Arts publication, representation focus
- **Mass Audience Viewer** - Casual viewer, entertainment focus
- **Social Impact Viewer** - Activist, ethics focus
