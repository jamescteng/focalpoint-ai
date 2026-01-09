# FocalPoint AI

Professional multimodal video analysis for indie filmmakers using Google's Gemini AI.

Get focus group-style feedback through configurable AI personas, each offering a distinct professional perspective on your film. Every report includes timestamped highlights, concerns with severity ratings, and answers to your research questions. Listen to personalized voice notes from each reviewer, or generate podcast-style dialogues between two AI reviewers.

## Features

- **On-Demand Persona Analysis** - Select one reviewer to start, add more after viewing
- **Large Video Support** - Upload videos up to 2GB with streaming uploads
- **Timestamped Feedback** - Every observation links to the exact moment
- **Structured Reports** - Executive summary, 5 highlights, 5 concerns, research answers
- **Reviewer Voice Notes** - Audio summaries with personalized opening/closing lines per persona
- **Podcast Dialogues** - Two-reviewer conversations discussing your video (English only)
- **Multi-Language** - English or Traditional Chinese output
- **Session Persistence** - Resume sessions anytime, all reports saved automatically
- **Secure** - API keys stay on the backend with rate limiting and input validation

## Personas

| Persona | Focus |
|---------|-------|
| **Acquisitions Director** | Commercial viability, pacing, marketability |
| **Cultural Editor** | Cultural relevance, emotional resonance, authorship |
| **Mass Audience Viewer** | Clarity, engagement, drop-off risk |
| **Social Impact Viewer** | Message clarity, ethical storytelling, trust |

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js with direct-to-storage uploads
- **AI**: Google Gemini API (`gemini-3-pro-preview`)
- **TTS**: ElevenLabs (`eleven_v3` for English, `eleven_multilingual_v2` for zh-TW)
- **Database**: PostgreSQL with Drizzle ORM
- **Storage**: Replit Object Storage for video uploads and audio files

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set your API keys:
   ```bash
   export GEMINI_API_KEY=your_gemini_key
   export ELEVENLABS_API_KEY=your_elevenlabs_key
   ```

3. Push database schema:
   ```bash
   npm run db:push
   ```

4. Run:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5000

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/uploads/init` | Initialize upload, get presigned URL |
| `POST /api/uploads/complete` | Mark storage upload complete, start Gemini transfer |
| `GET /api/uploads/status/:uploadId` | Poll upload/transfer progress |
| `POST /api/analyze` | Analyze video with selected personas |
| `GET /api/personas` | List available personas |
| `POST /api/sessions/:id/reports/:personaId/voice-script` | Generate voice note |
| `POST /api/dialogue/create` | Start podcast dialogue generation |
| `GET /api/dialogue/result/:id` | Get completed podcast dialogue |
| `GET /api/health` | Health check |

## Voice Notes

Each persona can generate an audio summary of their report with:
- Personalized opening/closing lines matching their personality
- Full coverage of highlights, concerns, and research answers
- Natural spoken-style prose (not robotic reading)
- Language-specific voice models for optimal quality

## Podcast Dialogues

Generate natural two-person conversations between any pair of reviewers:
- Both personas discuss highlights and concerns from their reports
- Single audio file with distinct voices for each participant
- **English only** (ElevenLabs API limitation)

## Limits

- Maximum video size: 2GB
- Video retention on Gemini: 48 hours
- 5 highlights + 5 concerns per report (enforced)

## License

MIT
