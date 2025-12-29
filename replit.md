# FocalPoint AI

## Overview
FocalPoint AI is a React + TypeScript + Vite application that provides advanced multimodal focus groups for professional indie creators. It uses Google's Gemini AI to analyze video content through multiple configurable personas, each offering a distinct professional perspective.

## Project Structure
- `/App.tsx` - Main application component
- `/index.tsx` - React entry point  
- `/index.html` - HTML template
- `/components/` - React components (Button, UploadForm, ProcessingQueue, ScreeningRoom)
- `/geminiService.ts` - Frontend service that calls the backend API
- `/server/index.ts` - Express backend server with Gemini API integration
- `/server/personas.ts` - Persona registry with full prompt configurations
- `/types.ts` - TypeScript type definitions
- `/constants.tsx` - Application constants and frontend persona data

## Tech Stack
- React 19
- TypeScript
- Vite 6 (build tool, dev server on port 5000)
- Express (backend API on port 3001)
- PostgreSQL + Drizzle ORM (session and report persistence)
- Tailwind CSS (via CDN)
- Inter + Noto Sans TC font stack (better CJK support)
- Google Gemini AI (@google/genai) - using gemini-3-flash-preview model

## Architecture
- Frontend runs on port 5000 (Vite dev server)
- Backend runs on port 3001 (Express server), binds to 0.0.0.0
- Vite proxies `/api` requests to the backend
- API key is securely stored as GEMINI_API_KEY secret (never exposed to frontend)
- express.json() middleware bypassed for /api/upload route to prevent memory buffering

### Video Upload Flow (Async with Background Processing)
The upload uses a job-based async architecture for responsive UI:

**Phase 1: File Reception (immediate response)**
1. Frontend uploads video file to `/api/upload` endpoint
2. Backend uses Busboy for streaming multipart parsing
3. Incoming stream is written to a temp spool file with backpressure handling
4. Backend returns immediately with `{ jobId, status: 'RECEIVED' }`

**Phase 2: Background Processing**
5. Backend uploads spool file to Gemini in 16MB chunks (resumable upload protocol)
6. Backend polls Gemini with exponential backoff (1s → 10s cap, ±20% jitter, 10 min timeout)
7. Job status updated: SPOOLING → UPLOADING → PROCESSING → ACTIVE

**Phase 3: Frontend Polling**
8. Frontend polls `GET /api/upload/status/:jobId` every 1.5s
9. Progress updates shown to user in real-time
10. Once ACTIVE, frontend receives fileUri and proceeds to analysis

**Job Store**
- In-memory Map stores job status (TTL: 1 hour)
- Status: RECEIVED | SPOOLING | UPLOADING | PROCESSING | ACTIVE | ERROR
- Progress: 0-100 percentage

**Limits & Validation**
- Maximum video size: 2GB (enforced on frontend and backend)
- Invalid MIME type or oversized files return 400
- Disk/upload errors return 500

### On-Demand Persona Flow
The app uses an on-demand approach for cost efficiency:
1. User selects ONE persona initially and starts analysis
2. Video is uploaded once, fileUri is cached in App state
3. User views the first report
4. User can click "Add Reviewer" to analyze with additional personas
5. Additional analyses reuse the cached fileUri (no re-upload)
6. All generated reports are cached - switching between them is instant
7. State is reset when user starts a completely new screening

### Multi-Persona Architecture
- Persona configurations stored in `/server/personas.ts`
- **House Style + Persona Edge pattern:**
  - `HOUSE_STYLE_GUIDELINES` - Shared tone rules prepended to all personas' systemInstruction
  - `OUTPUT_CONSTRAINTS_REMINDER` - Shared reminder appended to all personas' userPrompt
  - `SUMMARY_READABILITY_GUIDELINES` - Shared formatting rules injected into summary section only (short paragraphs, sentence limits, screen-readable rhythm)
  - `withHouseStyle` wrapper - Transforms RAW_PERSONA_CONFIGS into exported PERSONA_CONFIGS
  - Ensures consistent, respectful, constructive tone while preserving each persona's unique lens
- Each persona has unique:
  - System instruction (identity, lens, critical stance)
  - User prompt template
  - Highlight categories (e.g., emotion, craft, clarity, marketability, authorship, cultural_relevance)
  - Concern categories (e.g., pacing, clarity, character, audio, visual, tone, emotional_distance)
  - Minimum high-severity concern threshold
- Available personas:
  - `acquisitions_director` - Commercial viability, pacing, marketability focus (direct memo style)
  - `cultural_editor` - Cultural relevance, emotional resonance, authorship focus
  - `mass_audience_viewer` - Clarity, engagement, drop-off risk focus
  - `social_impact_viewer` - Message clarity, ethical storytelling, trust focus
- Error isolation: individual persona failures don't block other results

### API Endpoints
- `GET /api/health` - Health check
- `GET /api/personas` - List available personas with metadata
- `POST /api/upload` - Start video upload, returns `{ jobId, status }`
- `GET /api/upload/status/:jobId` - Check upload job status and get fileUri when ready
- `POST /api/analyze` - Analyze video with selected personas
  - Request: `{ title, synopsis, srtContent?, questions, language, fileUri, fileMimeType, personaIds }`
  - Response: `{ results: [{ personaId, status, report?, error?, validationWarnings? }] }`

### Polling Strategy
- Initial delay: 1 second
- Backoff factor: 1.5x per attempt
- Maximum delay: 10 seconds (capped)
- Jitter: ±20% randomization (500ms floor)
- Hard timeout: 10 minutes

### Analysis Response Schema
Each persona's report includes:
- `executive_summary`: Professional memo (300-500 words)
- `highlights`: Array of 5 positive moments with:
  - timestamp, seconds, summary, why_it_works, category
- `concerns`: Array of 5 critical issues with:
  - timestamp, seconds, issue, impact, severity (1-5), category, suggested_fix
- `answers`: Responses to user-defined research objectives

Server-side validation per persona:
- Exactly 5 highlights and 5 concerns expected (logs warning if violated)
- Severity clamped to 1-5 range
- Minimum high-severity concerns enforced per persona config

## Development
- Run: `npm run dev` (starts both frontend and backend concurrently)
- Frontend only: `vite`
- Backend only: `npm run server`
- Build: `npm run build`

## Environment Variables
- `GEMINI_API_KEY` - Required Gemini API key (stored as secret, used by backend only)

## Deployment
Autoscale deployment - builds frontend with Vite, serves via Express backend.

## Security Features

### Proxy Trust
- `app.set('trust proxy', 1)` - Trusts first proxy (Replit load balancer) for accurate IP detection in rate limiting

### Rate Limiting (express-rate-limit)
- `/api/upload`: 2 requests/minute per IP
- `/api/analyze`: 5 requests/minute per IP  
- `/api/health`, `/api/personas`: 20 requests/minute per IP

### CORS Restrictions
- Production: Only allows *.repl.co, *.replit.dev, *.replit.app origins
- Development: Allows localhost:5000

### Input Validation (/api/analyze)
- Title: required, max 200 characters
- Synopsis: max 5000 characters
- SRT content: max 500KB
- Questions: max 10, each max 500 characters
- Language: must be 'en' or 'zh-TW'
- fileUri: must start with 'https://generativelanguage.googleapis.com/'
- personaIds: validated against persona registry whitelist

### File Upload Validation
- MIME type must be video/* or in allowed list
- Maximum size: 2GB

### Error Sanitization
- Generic error messages returned to clients
- Full error details logged server-side only

## Database Schema

### sessions table
- `id` (serial, primary key)
- `title` (text, required)
- `synopsis` (text, required)
- `questions` (jsonb, array of strings)
- `language` (varchar, 'en' or 'zh-TW')
- `file_uri` (text, nullable - Gemini file URI)
- `file_mime_type` (text, nullable)
- `file_name` (text, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### reports table
- `id` (serial, primary key)
- `session_id` (references sessions.id, cascade delete)
- `persona_id` (varchar)
- `executive_summary` (text)
- `highlights` (jsonb, array)
- `concerns` (jsonb, array)
- `answers` (jsonb, array)
- `validation_warnings` (jsonb, array)
- `created_at` (timestamp)

### Session API Endpoints
- `POST /api/sessions` - Create a new session
- `GET /api/sessions` - List all sessions (ordered by date)
- `GET /api/sessions/:id` - Get session by ID
- `PUT /api/sessions/:id` - Update session (e.g., add file URI after upload)
- `DELETE /api/sessions/:id` - Delete session and all reports
- `GET /api/sessions/:id/reports` - Get all reports for a session
- `POST /api/sessions/:id/reports` - Save a report to a session

## Recent Changes
- **UI Design System Overhaul**:
  - Inter + Noto Sans TC font stack (better CJK support)
  - Reusable UI component library: Card, Badge, Pill, SeverityPill, Tabs, SectionHeader
  - Consistent shadows (soft, card, elevated) and radii
  - Tighter spacing and improved density
- **ScreeningRoom Tabbed Interface**:
  - Summary is now the first/default tab (renamed from Executive Summary)
  - Tabbed navigation: Summary | Highlights | Concerns
  - Expandable card content with "Read more" disclosure
  - Right sidebar is sticky with Profile | Goals tabs
  - Consistent header row pattern (timestamp | category | severity)
- **Streaming upload with Busboy**: Replaced multer with Busboy streaming parser for more efficient large file handling
- **Spool-first architecture**: Stream to temp file with backpressure, then upload to Gemini with exact file size (fixes Content-Length issues)
- **Improved error handling**: Invalid MIME types and oversized files return 400; disk/upload errors return 500
- Implemented House Style + Persona Edge pattern for consistent, constructive tone across all personas
- Removed antagonistic phrases from acquisitions persona while preserving direct memo style
- Added security hardening: rate limiting, CORS restrictions, input validation, error sanitization
- Implemented on-demand persona flow (select one first, add more after viewing)
- Video uploads only once per screening session, fileUri is cached
- Added "Add Reviewer" button in ScreeningRoom for incremental persona analysis
- Reports are cached in state - switching between personas is instant
- State properly resets when starting a new screening
- Removed dialogue/SRT input field; srtContent now optional
- **Database Persistence**: Added PostgreSQL database with Drizzle ORM for persistent sessions and reports
- **Session History UI**: History button in navbar to view and resume previous sessions
- **Auto-save**: Sessions and reports automatically saved to database
- **Language Label**: Added "Report language:" label near language selector for clarity
- **Updated default questions**: Removed "Is this film ready for festival run?" from defaults
- **Video Reattach Feature**: When loading sessions from history, video is not available (stored only on user's device). Users can reattach the original video file to enable playback and add more reviewers. Fingerprint verification (fileName, fileSize, lastModified) warns if selected file doesn't match the original.
