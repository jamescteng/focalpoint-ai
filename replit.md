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
| `server/services/videoCompressor.ts` | FFmpeg 720p/10fps compression |
| `server/services/compressionDecider.ts` | Smart compression decision logic (TDD) |
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
