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
- Tailwind CSS (via CDN)
- Google Gemini AI (@google/genai) - using gemini-3-flash-preview model

## Architecture
- Frontend runs on port 5000 (Vite dev server)
- Backend runs on port 3001 (Express server), binds to 0.0.0.0
- Vite proxies `/api` requests to the backend
- API key is securely stored as GEMINI_API_KEY secret (never exposed to frontend)
- express.json() middleware bypassed for /api/upload route to prevent memory buffering

### Video Upload Flow
1. Frontend uploads video file to `/api/upload` endpoint
2. Backend uses multer to save file to disk (not memory)
3. Backend streams file to Gemini in 16MB chunks using resumable upload protocol
4. Backend polls Gemini with exponential backoff (1s → 10s cap, ±20% jitter, 10 min timeout)
5. Frontend receives file URI, stores it in state for reuse across persona analyses
6. Backend uses `createPartFromUri` to reference video in Gemini request
7. Maximum video size: 2GB (enforced on frontend and backend)

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
- Each persona has unique:
  - System instruction (identity, lens, critical stance)
  - User prompt template
  - Highlight categories (e.g., emotion, craft, clarity, marketability, authorship, cultural_relevance)
  - Concern categories (e.g., pacing, clarity, character, audio, visual, tone, emotional_distance)
  - Minimum high-severity concern threshold
- Available personas:
  - `acquisitions_director` (Sarah Chen) - Commercial viability, pacing, marketability focus
  - `cultural_editor` (Maya Lin) - Cultural relevance, emotional resonance, authorship focus
- Error isolation: individual persona failures don't block other results

### API Endpoints
- `GET /api/health` - Health check
- `GET /api/personas` - List available personas with metadata
- `POST /api/upload` - Upload video file, returns file URI
- `POST /api/analyze` - Analyze video with selected personas
  - Request: `{ title, synopsis, srtContent, questions, language, fileUri, fileMimeType, personaIds }`
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

## Recent Changes
- Added security hardening: rate limiting, CORS restrictions, input validation, error sanitization
- Implemented on-demand persona flow (select one first, add more after viewing)
- Video uploads only once per screening session, fileUri is cached
- Added "Add Reviewer" button in ScreeningRoom for incremental persona analysis
- Reports are cached in state - switching between personas is instant
- State properly resets when starting a new screening
