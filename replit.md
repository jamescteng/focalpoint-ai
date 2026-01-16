# FocalPoint AI

## Overview
AI focus group platform for indie filmmakers. Gemini AI analyzes videos through four distinct personas, providing timestamped feedback, voice notes, and podcast dialogues.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Vite (port 5000), Tailwind CSS
- **Backend**: Express (port 3001), proxied via Vite `/api`
- **AI**: Google Gemini (`gemini-3-pro-preview`)
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

## API Resilience
- **Retry logic**: `withRetries()` in analyze.ts - exponential backoff (250ms→5s cap, max 4 attempts, ±10% jitter)
- **Transient error detection**: HTTP 429/500/502/503/504, network codes (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND)
- **Model fallback**: Primary `gemini-3-pro-preview` → fallback `gemini-2.5-flash` on transient errors after retries exhausted
- **Upload timeout**: 40 minutes for frontend polling
- **Gemini processing timeout**: 22.5 minutes (90 attempts × 15s) for file to become ACTIVE
- **Analysis timeout**: 15 minutes for frontend API call to /api/analyze

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
