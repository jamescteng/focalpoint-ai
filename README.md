# FocalPoint AI

AI-powered focus group feedback for indie filmmakers using Google Gemini AI.

## Features

- **Multi-Persona Analysis** - Four AI reviewers with distinct perspectives analyze your video simultaneously
- **YouTube or Upload** - Paste public YouTube URLs or upload files up to 2GB (smart compression: only applied when needed)
- **Timestamped Feedback** - Highlights and concerns linked to exact video moments, with confidence-graded timestamps via two-pass grounding
- **Global Context Cache** - Uploaded videos cached once and shared across all persona analyses + grounding passes (up to 8 API calls at 90% token discount)
- **Voice Notes** - ElevenLabs audio summaries from each reviewer
- **Podcast Dialogues** - Two-reviewer conversations discussing your film (English only)
- **Bilingual UI** - Full English and Traditional Chinese support with language switcher
- **Mobile Resilient** - Fire-and-forget analysis pattern handles screen locks and app switches gracefully

## AI Personas

| Persona | Focus Area |
|---------|------------|
| Acquisitions Director | Commercial viability, distribution potential |
| Cultural Editor | Artistic merit, cultural representation |
| Mass Audience Viewer | Clarity, pacing, entertainment value |
| Social Impact Viewer | Message effectiveness, ethical considerations |

## Quick Start

```bash
npm install
npm run db:push
npm run dev
```

Run tests:
```bash
npx jest --config jest.config.cjs   # Server tests
npm test                             # Frontend tests (Vitest)
```

Required secrets: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `YOUTUBE_API_KEY`

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Express.js on port 3001 (proxied via Vite) |
| AI | Google Gemini (`gemini-3-flash-preview` with `MEDIA_RESOLUTION_LOW`) |
| TTS | ElevenLabs (`eleven_v3` / `eleven_multilingual_v2`) |
| Database | PostgreSQL + Drizzle ORM |
| Storage | Replit Object Storage |

## How Analysis Works

1. **Upload or YouTube** - Video uploaded to Gemini Files API (or YouTube URL passed directly)
2. **Global Cache** - A single Gemini context cache is created for the video, shared across all analyses
3. **Fire-and-Forget** - `POST /api/analyze` returns job IDs immediately; analysis runs in background
4. **Two-Pass Grounding** - Each persona's analysis is followed by a Search-not-Verify grounding pass that independently locates timestamps to avoid confirmation bias
5. **Confidence Scoring** - Timestamp confidence computed from delta between analysis and grounding results (≤10s = high, ≤30s = medium, >30s = low)
6. **Cache Cleanup** - Global cache automatically deleted after all jobs complete

## API Resilience

- Exponential backoff retries with jitter (up to 4 attempts)
- 120-second API timeout per request
- Model fallback: `gemini-3-flash-preview` → `gemini-2.5-flash`
- Cache-expiry fallback: if cached request fails, retries without cache automatically
- Transient error detection (HTTP 429/5xx, network errors, timeouts)

## Security

- Rate limiting on expensive operations (voice/podcast generation, polling)
- Sanitized error responses (details logged server-side only)
- Input validation on all API endpoints

## License

MIT
