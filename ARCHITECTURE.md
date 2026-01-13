# FocalPoint AI - Architecture Overview

## Product Overview

### What It Does
FocalPoint AI is an AI-powered focus group platform for indie filmmakers. It analyzes video content through multiple AI "reviewers" (personas), each offering a distinct professional perspective with timestamped feedback. Additionally, it offers **Reviewer Voice Notes** (audio summaries of reports) and **Podcast Dialogues** (two-reviewer conversations).

### Who It's For
- Independent filmmakers seeking professional feedback before festival submissions
- Documentary creators wanting diverse audience perspectives
- Content creators looking for actionable improvement suggestions

### Core Value Proposition
Get instant, multi-perspective feedback on your video that would traditionally require expensive focus groups or industry connections.

---

## User Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER FLOW                                          │
└─────────────────────────────────────────────────────────────────────────────┘

1. SETUP SESSION
   ├── Enter video title and synopsis
   ├── Add research questions (what you want to learn)
   └── Select report language (English or Traditional Chinese)

2. UPLOAD VIDEO
   ├── Select video file (up to 2GB)
   ├── File fingerprint captured (name, size, date) for later reattachment
   └── Progress bar shows upload status

3. CHOOSE FIRST REVIEWER
   ├── Select ONE persona to start (cost-efficient approach)
   └── Available reviewers:
       • Acquisitions Director - Commercial viability, marketability
       • Cultural Editor - Artistic merit, authenticity, representation
       • Mass Audience Viewer - Clarity, engagement, entertainment value
       • Social Impact Viewer - Message effectiveness, ethical storytelling

4. VIEW ANALYSIS
   ├── Summary tab: Executive overview (300-500 words)
   ├── Highlights tab: 5 standout moments with timestamps
   └── Concerns tab: 5 issues with severity ratings and suggested fixes

5. ADD MORE REVIEWERS (Optional)
   ├── Click "Add Reviewer" for additional perspectives
   ├── No re-upload needed (video cached server-side)
   └── Switch between reports instantly

6. LISTEN TO VOICE NOTES (Optional)
   ├── Generate audio summary for any reviewer's report
   ├── Personalized opening/closing lines per persona
   └── Available in English or Traditional Chinese

7. GENERATE PODCAST DIALOGUE (Optional, English Only)
   ├── Select two reviewers for a conversation
   ├── AI generates natural dialogue between them
   └── Single audio file with distinct voices

8. RESUME LATER (Session Persistence)
   ├── Sessions auto-save to database
   ├── Access history from navbar
   └── Reattach video file to enable playback on return
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM COMPONENTS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│    Vite      │────▶│   Express    │────▶│  Gemini AI   │
│   (React)    │     │   Proxy      │     │   Backend    │     │   (Google)   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                                         │                     │
       │                                         │                     │
       ▼                                         ▼                     ▼
┌──────────────┐                         ┌──────────────┐     ┌──────────────┐
│ Local Video  │                         │  PostgreSQL  │     │  ElevenLabs  │
│   Playback   │                         │   Database   │     │   (TTS)      │
└──────────────┘                         └──────────────┘     └──────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │   Replit     │
                                         │   Object     │
                                         │   Storage    │
                                         └──────────────┘


COMPONENT DETAILS:

┌─────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React + TypeScript + Vite)                         Port 5000      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Main Components:                                                            │
│ • App.tsx              - Main state management, session orchestration       │
│ • UploadForm.tsx       - Video upload, metadata entry, fingerprint capture  │
│ • ScreeningRoom.tsx    - Report display, video player, reviewer switching   │
│ • VoicePlayer.tsx      - Voice note audio playback and transcript           │
│ • ReviewerPairPicker.tsx - Podcast persona selection UI                     │
│ • DialoguePlayer.tsx   - Podcast dialogue playback with transcript          │
│                                                                             │
│ Extracted UI Components:                                                    │
│ • HighlightCard.tsx    - Individual highlight display with HighlightsList   │
│ • ConcernCard.tsx      - Individual concern display with ConcernsList       │
│ • ui/ExpandableContent.tsx - Truncated text with expand/collapse            │
│ • ui/reportHelpers.ts  - Category icons, formatters                         │
│ • ui/Card.tsx, Badge.tsx, Pill.tsx, SeverityPill.tsx - Reusable primitives  │
│                                                                             │
│ Services:                                                                   │
│ • geminiService.ts     - API client with polling logic                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ /api/* requests proxied
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ BACKEND (Express + TypeScript)                               Port 3001      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Entry Point:                                                                │
│ • server/index.ts (~175 lines) - Mounts all route modules                   │
│                                                                             │
│ Route Modules (server/routes/):                                             │
│ • sessions.ts    - Session CRUD endpoints                                   │
│ • reports.ts     - Report get/save endpoints                                │
│ • voice.ts       - Voice script generation, audio streaming                 │
│ • analyze.ts     - Video analysis endpoint                                  │
│                                                                             │
│ Other Routes:                                                               │
│ • uploadRoutes.ts   - Direct-to-storage upload endpoints, Gemini transfer   │
│ • dialogueRoutes.ts - Podcast dialogue job endpoints                        │
│                                                                             │
│ Middleware (server/middleware/):                                            │
│ • validation.ts     - Shared input validation                               │
│ • rateLimiting.ts   - Rate limiting configuration                           │
│                                                                             │
│ Utilities (server/utils/):                                                  │
│ • personaAliases.ts - Persona alias generation                              │
│ • logger.ts         - Centralized logging                                   │
│                                                                             │
│ API Endpoints:                                                              │
│ • POST /api/uploads/init        - Initialize upload, get presigned URL      │
│ • POST /api/uploads/complete    - Mark storage upload complete              │
│ • GET  /api/uploads/status/:id  - Poll upload/transfer progress             │
│ • POST /api/analyze             - Run AI analysis with selected personas    │
│ • CRUD /api/sessions            - Session persistence                       │
│ • CRUD /api/sessions/:id/reports - Report storage                           │
│ • POST /api/sessions/:id/reports/:personaId/voice-script - Generate voice   │
│ • POST /api/dialogue/create     - Start podcast dialogue job                │
│ • GET  /api/dialogue/status/:id - Poll dialogue job status                  │
│ • GET  /api/dialogue/result/:id - Get completed dialogue audio/transcript   │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                   ┌───────────────┼───────────────┬───────────────┐
                   ▼               ▼               ▼               ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ GEMINI AI             │ │ POSTGRESQL            │ │ ELEVENLABS            │
├───────────────────────┤ ├───────────────────────┤ ├───────────────────────┤
│ • Video understanding │ │ • sessions table      │ │ • Text-to-Speech      │
│ • Multimodal analysis │ │ • reports table       │ │ • eleven_v3 (English) │
│ • Persona prompts     │ │ • voice_scripts table │ │ • eleven_multilingual │
│ • Voice script gen    │ │ • dialogue_jobs table │ │   _v2 (zh-TW)         │
│ • Dialogue script gen │ │                       │ │ • Text-to-Dialogue    │
│                       │ │                       │ │   API (English only)  │
│ Model: gemini-3-pro-  │ └───────────────────────┘ └───────────────────────┘
│        preview        │
└───────────────────────┘
                                         │
                                         ▼
                                ┌───────────────────────┐
                                │ REPLIT OBJECT STORAGE │
                                ├───────────────────────┤
                                │ • Video uploads       │
                                │   (direct-to-storage) │
                                │ • Voice note audio    │
                                │ • Podcast dialogue    │
                                │   audio files         │
                                └───────────────────────┘
```

---

## Data Flow: Video Upload

```
┌─────────────────────────────────────────────────────────────────────────────┐
│           VIDEO UPLOAD FLOW (Direct-to-Storage with AI Proxy)                │
└─────────────────────────────────────────────────────────────────────────────┘

USER          FRONTEND         BACKEND              OBJECT STORAGE      GEMINI
 │               │                 │                      │                │
 │ Select file   │                 │                      │                │
 │──────────────▶│                 │                      │                │
 │               │                 │                      │                │
 │               │ POST /init      │                      │                │
 │               │────────────────▶│ Generate presigned   │                │
 │               │                 │ PUT URL ────────────▶│                │
 │               │◀────────────────│                      │                │
 │               │                 │                      │                │
 │ Progress 0-40%│ XHR PUT         │                      │                │
 │◀──────────────│─────────────────────────────────────────▶ (Original)    │
 │               │                 │                      │                │
 │               │ POST /complete  │                      │                │
 │               │────────────────▶│ Verify size match    │                │
 │               │◀────────────────│◀─────────────────────│                │
 │               │                 │                      │                │
 │ Progress      │                 │ Download original    │                │
 │ 40-45%        │ Poll status     │◀─────────────────────│                │
 │◀──────────────│◀────────────────│                      │                │
 │               │                 │                      │                │
 │ Progress      │                 │ FFmpeg compress      │                │
 │ 45-75%        │ Poll status     │ (720p, 10fps, CRF28) │                │
 │◀──────────────│◀────────────────│                      │                │
 │               │                 │                      │                │
 │ Progress 75%  │                 │ Upload proxy ───────▶│ (Proxy ~50MB)  │
 │◀──────────────│◀────────────────│                      │                │
 │               │                 │                      │                │
 │ Progress      │                 │ Transfer proxy ──────────────────────▶│
 │ 75-95%        │ Poll status     │ (16MB chunks)        │                │
 │◀──────────────│◀────────────────│                      │                │
 │               │                 │                      │   Processing   │
 │               │        ...      │         ...          │       ...      │
 │               │                 │                      │                │
 │ Progress 100% │ { ACTIVE, URI } │◀──────────────────────────────────────│
 │◀──────────────│◀────────────────│                      │                │
 │               │                 │                      │                │
 │ Ready!        │                 │                      │                │


UPLOAD STATES:
  UPLOADING → STORED → COMPRESSING → COMPRESSED → TRANSFERRING_TO_GEMINI → ACTIVE
                                                                       └─→ FAILED

PROGRESS MAPPING:
  Stage 1 (Storage Upload):  0-40%   - XHR progress events (original file)
  Stage 2 (Compression):     40-75%  - FFmpeg 720p/10fps compression
  Stage 3 (Gemini Transfer): 75-95%  - Upload compressed proxy to Gemini
  Stage 4 (Ready):           95-100% - Gemini processes, file ACTIVE

KEY FEATURES:
  • Original file preserved in storage for playback
  • 720p/10fps "analysis proxy" for Gemini (50-100x smaller)
  • Dramatically faster Gemini transfers and reduced API costs
  • Direct browser-to-storage upload bypasses server size limits
  • Same attemptId returns same uploadId (idempotency)
  • Server-side size verification (hard failure on mismatch)
  • User-friendly progress messages at each stage
```

---

## Data Flow: Video Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ANALYSIS FLOW                                        │
└─────────────────────────────────────────────────────────────────────────────┘

FRONTEND                      BACKEND                           GEMINI
    │                            │                                 │
    │ POST /api/analyze          │                                 │
    │ { fileUri, personaIds,     │                                 │
    │   title, synopsis, ... }   │                                 │
    │───────────────────────────▶│                                 │
    │                            │                                 │
    │                            │ For each persona:               │
    │                            │                                 │
    │                            │  ┌─────────────────────────────┐│
    │                            │  │ Build system instruction    ││
    │                            │  │ + house style guidelines    ││
    │                            │  └─────────────────────────────┘│
    │                            │                                 │
    │                            │  generateContent({             │
    │                            │    systemInstruction,          │
    │                            │    video: fileUri,             │
    │                            │    prompt                      │
    │                            │  })                            │
    │                            │────────────────────────────────▶│
    │                            │                                 │
    │                            │                    AI watches   │
    │                            │                    full video   │
    │                            │                         │       │
    │                            │                         ▼       │
    │                            │              Generates structured
    │                            │              JSON response      │
    │                            │                                 │
    │                            │  { executive_summary,          │
    │                            │    highlights[5],              │
    │                            │    concerns[5],                │
    │                            │    answers[] }                 │
    │                            │◀────────────────────────────────│
    │                            │                                 │
    │                            │  Validate response:            │
    │                            │  - Check highlight/concern count
    │                            │  - Clamp severity 1-5          │
    │                            │  - Log warnings                │
    │                            │                                 │
    │ { results: [               │                                 │
    │   { personaId, report }    │                                 │
    │ ]}                         │                                 │
    │◀───────────────────────────│                                 │
    │                            │                                 │
    │ Display in ScreeningRoom   │                                 │
    │                            │                                 │
```

---

## Data Flow: Voice Notes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VOICE NOTE GENERATION (Three-Pass Pipeline)               │
└─────────────────────────────────────────────────────────────────────────────┘

FRONTEND                      BACKEND                     GEMINI        ELEVENLABS
    │                            │                           │              │
    │ POST /voice-script         │                           │              │
    │ { generateAudio: true }    │                           │              │
    │───────────────────────────▶│                           │              │
    │                            │                           │              │
    │                            │ PASS A: Deterministic     │              │
    │                            │ Build structured draft    │              │
    │                            │ covering all highlights,  │              │
    │                            │ concerns, answers         │              │
    │                            │                           │              │
    │                            │ Generate personalized     │              │
    │                            │ open/close lines          │              │
    │                            │──────────────────────────▶│              │
    │                            │                           │              │
    │                            │ { openingLines[2],        │              │
    │                            │   closingLines[2] }       │              │
    │                            │◀──────────────────────────│              │
    │                            │                           │              │
    │                            │ PASS B: Naturalization    │              │
    │                            │──────────────────────────▶│              │
    │                            │                           │              │
    │                            │ Rewrite as natural        │              │
    │                            │ spoken text with          │              │
    │                            │ audio tags (English)      │              │
    │                            │◀──────────────────────────│              │
    │                            │                           │              │
    │                            │ AUDIO GENERATION          │              │
    │                            │                           │              │
    │                            │ English: eleven_v3        │              │
    │                            │ zh-TW: eleven_multilingual_v2            │
    │                            │─────────────────────────────────────────▶│
    │                            │                           │              │
    │                            │                           │   { audio }  │
    │                            │◀─────────────────────────────────────────│
    │                            │                           │              │
    │                            │ Store audio in Object     │              │
    │                            │ Storage, cache script     │              │
    │                            │                           │              │
    │ { transcript, audioUrl }   │                           │              │
    │◀───────────────────────────│                           │              │


VOICE MODEL SELECTION:
  English:  eleven_v3 (stability=0.0, supports audio tags like <chuckle>)
  zh-TW:    eleven_multilingual_v2 (stability=0.5, audio tags stripped)
```

---

## Data Flow: Podcast Dialogue

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PODCAST DIALOGUE GENERATION (English Only)                │
└─────────────────────────────────────────────────────────────────────────────┘

FRONTEND                      BACKEND                     GEMINI        ELEVENLABS
    │                            │                           │              │
    │ POST /dialogue/create      │                           │              │
    │ { personaIdA, personaIdB } │                           │              │
    │───────────────────────────▶│                           │              │
    │                            │                           │              │
    │ { jobId }                  │ Create dialogue job       │              │
    │◀───────────────────────────│ (status: queued)          │              │
    │                            │                           │              │
    │                            │ SCRIPT GENERATION         │              │
    │                            │ Build conversation        │              │
    │                            │ between two personas      │              │
    │                            │──────────────────────────▶│              │
    │                            │                           │              │
    │                            │ { participants[],         │              │
    │                            │   turns[],                │              │
    │                            │   coverage }              │              │
    │                            │◀──────────────────────────│              │
    │                            │                           │              │
    │ Poll GET /status/:jobId    │                           │              │
    │───────────────────────────▶│                           │              │
    │                            │                           │              │
    │ { status: 'generating' }   │                           │              │
    │◀───────────────────────────│                           │              │
    │                            │                           │              │
    │                            │ TEXT-TO-DIALOGUE API      │              │
    │                            │ (ElevenLabs endpoint)     │              │
    │                            │─────────────────────────────────────────▶│
    │                            │                           │              │
    │                            │                    Single audio file     │
    │                            │                    with distinct voices  │
    │                            │◀─────────────────────────────────────────│
    │                            │                           │              │
    │                            │ Store in Object Storage   │              │
    │                            │ Update job status         │              │
    │                            │                           │              │
    │ Poll GET /status/:jobId    │                           │              │
    │───────────────────────────▶│                           │              │
    │                            │                           │              │
    │ { status: 'complete' }     │                           │              │
    │◀───────────────────────────│                           │              │
    │                            │                           │              │
    │ GET /dialogue/result/:id   │                           │              │
    │───────────────────────────▶│                           │              │
    │                            │                           │              │
    │ { audioUrl, transcript,    │                           │              │
    │   participants, turns }    │                           │              │
    │◀───────────────────────────│                           │              │


LANGUAGE RESTRICTION:
  ElevenLabs Text-to-Dialogue API only supports English.
  UI shows "English Only" badge for zh-TW sessions.
```

---

## Key Technical Decisions

### 1. On-Demand Persona Analysis
**Why:** Cost efficiency. Each Gemini API call with video costs money.
**How:** User picks one reviewer first, views results, then optionally adds more. Video is cached server-side via `fileUri` so no re-upload needed.

### 2. Streaming Upload with Busboy
**Why:** Handle large files (up to 2GB) without running out of memory.
**How:** Stream directly to temp file with backpressure handling, then upload to Gemini in 16MB resumable chunks.

### 3. House Style + Persona Edge Pattern
**Why:** Ensure all personas give constructive, professional feedback while maintaining distinct voices.
**How:** Shared `HOUSE_STYLE_GUIDELINES` prepended to all persona prompts. Each persona adds their unique lens on top.

### 4. Video Fingerprinting for Reattachment
**Why:** Gemini's `fileUri` is for AI analysis only, not video playback. When users return to a session, they need to reattach their local file.
**How:** Store `fileName`, `fileSize`, `fileLastModified` in database. On reattach, verify fingerprint matches to warn if wrong file selected.

### 5. Polling with Exponential Backoff
**Why:** Gemini video processing can take minutes. Aggressive polling wastes resources.
**How:** Start at 1s, multiply by 1.5x each poll, cap at 10s, add ±20% jitter to prevent thundering herd.

### 6. Session Persistence
**Why:** Video analysis is valuable output users want to keep and reference.
**How:** Auto-save sessions and reports to PostgreSQL. Users can access history from navbar and resume any session.

### 7. Three-Pass Voice Script Pipeline
**Why:** Ensure comprehensive coverage while maintaining natural speech patterns.
**How:** 
- Pass A: Deterministic draft guaranteeing all highlights/concerns mentioned
- Pass B: LLM naturalizes into spoken-style prose with persona personality
- Audio: ElevenLabs TTS with language-specific model selection

### 8. Personalized Voice Opening/Closing Lines
**Why:** Make each persona's voice note feel authentic to their character.
**How:** LLM generates 2 opening + 2 closing options based on persona role, voice style, and specific report content. Fallback to generic lines on error.

### 9. Language-Specific TTS Models
**Why:** Optimize audio quality for each language.
**How:**
- English: `eleven_v3` with stability=0.0 (natural variation), supports audio emotion tags
- zh-TW: `eleven_multilingual_v2` with stability=0.5, audio tags stripped (unsupported)

### 10. Podcast Dialogue (English Only)
**Why:** Create engaging two-person discussions from multiple reviewer perspectives.
**How:** Generate dialogue script via Gemini, use ElevenLabs Text-to-Dialogue API for multi-voice audio. API limitation: English only.

---

## Database Schema

```sql
sessions
├── id (serial, PK)
├── title (text)
├── synopsis (text)
├── questions (jsonb)
├── language (varchar) -- 'en' or 'zh-TW'
├── file_uri (text, nullable)
├── file_mime_type (text, nullable)
├── file_name (text, nullable)
├── file_size (bigint, nullable)
├── file_last_modified (bigint, nullable)
├── persona_aliases (jsonb) -- Custom names/roles for personas
├── created_at (timestamp)
└── updated_at (timestamp)

reports
├── id (serial, PK)
├── session_id (FK → sessions.id, cascade delete)
├── persona_id (varchar)
├── executive_summary (text)
├── highlights (jsonb)
├── concerns (jsonb)
├── answers (jsonb)
├── validation_warnings (jsonb)
└── created_at (timestamp)

voice_scripts
├── id (serial, PK)
├── session_id (FK → sessions.id, cascade delete)
├── persona_id (varchar)
├── report_hash (varchar) -- Cache key for invalidation
├── language (varchar)
├── script_json (jsonb) -- Full voice script structure
├── audio_url (text, nullable) -- Object Storage URL
└── created_at (timestamp)

dialogue_jobs
├── id (serial, PK)
├── session_id (FK → sessions.id, cascade delete)
├── persona_a (varchar) -- First reviewer in dialogue
├── persona_b (varchar) -- Second reviewer in dialogue
├── language (varchar)
├── status (varchar) -- queued, generating, complete, failed
├── script_json (jsonb, nullable) -- Dialogue script with turns
├── audio_storage_key (text, nullable) -- Object Storage key
├── attempt_count (integer)
├── last_error (text, nullable)
├── created_at (timestamp)
└── updated_at (timestamp)
```

---

## Security Measures

| Layer | Protection |
|-------|------------|
| API Rate Limiting | `/upload`: 2/min, `/analyze`: 5/min per IP |
| CORS | Production: only `*.replit.app/dev/co` origins |
| Input Validation | Title max 200 chars, synopsis 5K, SRT 500KB, 10 questions |
| File Validation | Must be `video/*`, max 2GB |
| Secrets | `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` never exposed to frontend |
| Error Handling | Generic messages to clients, full details logged server-side |

---

## API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/personas` | GET | List available reviewers |
| `/api/upload` | POST | Start video upload job |
| `/api/upload/status/:jobId` | GET | Poll upload progress |
| `/api/analyze` | POST | Run AI analysis |
| `/api/sessions` | GET/POST | List or create sessions |
| `/api/sessions/:id` | GET/PUT/DELETE | Session CRUD |
| `/api/sessions/:id/reports` | GET/POST | Session reports |
| `/api/sessions/:id/reports/:personaId/voice-script` | GET/POST | Voice script generation/retrieval |
| `/api/dialogue/create` | POST | Start podcast dialogue job |
| `/api/dialogue/status/:jobId` | GET | Poll dialogue job status |
| `/api/dialogue/result/:jobId` | GET | Get completed dialogue |
| `/api/dialogue/session/:sessionId` | GET | List dialogues for session |

---

## Tech Stack Summary

| Component | Technology |
|-----------|------------|
| Frontend | React 19, TypeScript, Vite 6 |
| Styling | Tailwind CSS (CDN) |
| Backend | Express, TypeScript, Node.js |
| Database | PostgreSQL + Drizzle ORM |
| AI | Google Gemini (gemini-3-pro-preview) |
| TTS | ElevenLabs (eleven_v3, eleven_multilingual_v2) |
| Storage | Replit Object Storage |
| Testing | Vitest (frontend), Jest (backend) |

---

## Local Development

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start dev server (frontend + backend)
npm run dev

# Run tests
npm run test:all
```

- Frontend: http://localhost:5000
- Backend API: http://localhost:3001 (proxied via Vite)
