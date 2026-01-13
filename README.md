# FocalPoint AI

AI-powered focus group feedback for indie filmmakers using Google Gemini AI.

## Features

- **Multi-Persona Analysis** - Four AI reviewers with distinct perspectives analyze your video simultaneously
- **YouTube or Upload** - Paste public YouTube URLs or upload files up to 2GB (auto-compressed to 720p/10fps)
- **Timestamped Feedback** - Highlights and concerns linked to exact video moments
- **Voice Notes** - ElevenLabs audio summaries from each reviewer
- **Podcast Dialogues** - Two-reviewer conversations discussing your film (English only)
- **Bilingual UI** - Full English and Traditional Chinese support with language switcher

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

Required secrets: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `YOUTUBE_API_KEY`

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Express.js on port 3001 (proxied via Vite) |
| AI | Google Gemini (gemini-3-pro-preview) |
| TTS | ElevenLabs (eleven_v3 / eleven_multilingual_v2) |
| Database | PostgreSQL + Drizzle ORM |
| Storage | Replit Object Storage |

## Security

- Rate limiting on expensive operations (voice/podcast generation, polling)
- Sanitized error responses (details logged server-side only)
- Input validation on all API endpoints

## License

MIT
