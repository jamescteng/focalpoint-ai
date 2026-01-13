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
| `/api/analyze` | Run Gemini analysis with selected personas |
| `/api/sessions/*` | CRUD for sessions and reports |
| `/api/voice/*` | Voice script generation + ElevenLabs TTS |
| `/api/dialogue/*` | Podcast job creation and polling |
| `/api/personas` | List available personas |

**Security**: Rate limiting (1/min voice, 1/min podcast, 20/min polling), sanitized errors.

## Data Flow

### Upload → Analysis
1. Browser uploads to Object Storage via presigned URL
2. Server compresses to 720p/10fps proxy (~85% size reduction)
3. Proxy transferred to Gemini Files API
4. Analysis runs when file status = ACTIVE

### YouTube → Analysis
1. URL validated via YouTube Data API v3
2. Gemini analyzes directly from YouTube URL
3. No upload/compression needed

### Voice Notes
1. Report → structured script → LLM naturalizes prose
2. ElevenLabs TTS → audio file → Object Storage
3. Cached in `voice_scripts` table

### Podcast Dialogue
1. Select two personas → generate debate script
2. ElevenLabs conversational API → dual-voice audio
3. Stored in `dialogue_jobs` table (English only)

## Database Schema

| Table | Purpose |
|-------|---------|
| `sessions` | Video metadata, questions, language preference |
| `reports` | AI analysis results per persona |
| `voice_scripts` | Cached voice scripts + audio URLs |
| `dialogue_jobs` | Podcast generation state machine |
| `uploads` | Upload progress tracking |

## Personas

Four distinct reviewer perspectives, each with unique voice/demographics:
- **Acquisitions Director** - Industry veteran, commercial focus
- **Cultural Editor** - Arts publication, representation focus
- **Mass Audience Viewer** - Casual viewer, entertainment focus
- **Social Impact Viewer** - Activist, ethics focus
