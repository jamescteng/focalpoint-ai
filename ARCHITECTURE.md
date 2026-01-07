# FocalPoint AI - Architecture Overview

## Product Overview

### What It Does
FocalPoint AI is an AI-powered focus group platform for indie filmmakers. It analyzes video content through multiple AI "reviewers" (personas), each offering a distinct professional perspective with timestamped feedback.

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

6. RESUME LATER (Session Persistence)
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
       │                                         │
       │                                         │
       ▼                                         ▼
┌──────────────┐                         ┌──────────────┐
│ Local Video  │                         │  PostgreSQL  │
│   Playback   │                         │   Database   │
└──────────────┘                         └──────────────┘


COMPONENT DETAILS:

┌─────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React + TypeScript + Vite)                         Port 5000      │
├─────────────────────────────────────────────────────────────────────────────┤
│ • App.tsx           - Main state management, session orchestration          │
│ • UploadForm.tsx    - Video upload, metadata entry, fingerprint capture     │
│ • ScreeningRoom.tsx - Report display, video player, reviewer switching      │
│ • geminiService.ts  - API client with polling logic                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ /api/* requests proxied
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ BACKEND (Express + TypeScript)                               Port 3001      │
├─────────────────────────────────────────────────────────────────────────────┤
│ • POST /api/upload         - Receive video, stream to Gemini               │
│ • GET  /api/upload/status  - Poll upload job status                        │
│ • POST /api/analyze        - Run AI analysis with selected personas        │
│ • CRUD /api/sessions       - Session persistence                           │
│ • CRUD /api/sessions/:id/reports - Report storage                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────┐       ┌───────────────────────────┐
│ GEMINI AI                 │       │ POSTGRESQL                │
├───────────────────────────┤       ├───────────────────────────┤
│ • Video understanding     │       │ • sessions table          │
│ • Multimodal analysis     │       │   - title, synopsis       │
│ • Persona-based prompts   │       │   - questions, language   │
│ • Structured JSON output  │       │   - file fingerprint      │
│                           │       │                           │
│ Model: gemini-3-flash-    │       │ • reports table           │
│        preview            │       │   - persona_id            │
└───────────────────────────┘       │   - summary, highlights   │
                                    │   - concerns, answers     │
                                    └───────────────────────────┘
```

---

## Data Flow: Video Upload

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VIDEO UPLOAD FLOW (Async Job-Based)                       │
└─────────────────────────────────────────────────────────────────────────────┘

USER                    FRONTEND                 BACKEND                 GEMINI
 │                         │                        │                       │
 │ Select video file       │                        │                       │
 │────────────────────────▶│                        │                       │
 │                         │                        │                       │
 │                         │ POST /api/upload       │                       │
 │                         │ (multipart stream)     │                       │
 │                         │───────────────────────▶│                       │
 │                         │                        │                       │
 │                         │                        │ Stream to temp file   │
 │                         │                        │──────────┐            │
 │                         │                        │          │            │
 │                         │ { jobId, status }      │◀─────────┘            │
 │                         │◀───────────────────────│                       │
 │                         │                        │                       │
 │  Show progress bar      │                        │ Upload to Gemini      │
 │◀────────────────────────│                        │ (16MB chunks)         │
 │                         │                        │──────────────────────▶│
 │                         │                        │                       │
 │                         │ Poll GET /status/:id   │                       │
 │                         │───────────────────────▶│                       │
 │                         │                        │                       │
 │                         │ { progress: 45% }      │ Processing...         │
 │                         │◀───────────────────────│◀──────────────────────│
 │                         │                        │                       │
 │  Update progress        │        ...             │        ...            │
 │◀────────────────────────│                        │                       │
 │                         │                        │                       │
 │                         │ { status: ACTIVE,      │ { fileUri }           │
 │                         │   fileUri }            │◀──────────────────────│
 │                         │◀───────────────────────│                       │
 │                         │                        │                       │
 │  Ready for analysis!    │                        │                       │
 │◀────────────────────────│                        │                       │


JOB STATES:
  RECEIVED → SPOOLING → UPLOADING → PROCESSING → ACTIVE
                                              └─→ ERROR
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
```

---

## Security Measures

| Layer | Protection |
|-------|------------|
| API Rate Limiting | `/upload`: 2/min, `/analyze`: 5/min per IP |
| CORS | Production: only `*.replit.app/dev/co` origins |
| Input Validation | Title max 200 chars, synopsis 5K, SRT 500KB, 10 questions |
| File Validation | Must be `video/*`, max 2GB |
| Secrets | `GEMINI_API_KEY` never exposed to frontend |
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

---

## Tech Stack Summary

| Component | Technology |
|-----------|------------|
| Frontend | React 19, TypeScript, Vite 6 |
| Styling | Tailwind CSS (CDN) |
| Backend | Express, TypeScript, Node.js |
| Database | PostgreSQL + Drizzle ORM |
| AI | Google Gemini (gemini-3-flash-preview) |
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
