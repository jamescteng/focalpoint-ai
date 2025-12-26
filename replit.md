# FocalPoint AI

## Overview
FocalPoint AI is a React + TypeScript + Vite application that provides advanced multimodal focus groups for professional indie creators. It uses Google's Gemini AI to analyze video content.

## Project Structure
- `/App.tsx` - Main application component
- `/index.tsx` - React entry point  
- `/index.html` - HTML template
- `/components/` - React components (Button, UploadForm, ProcessingQueue, ScreeningRoom)
- `/geminiService.ts` - Frontend service that calls the backend API
- `/server/index.ts` - Express backend server with Gemini API integration
- `/types.ts` - TypeScript type definitions
- `/constants.tsx` - Application constants and personas

## Tech Stack
- React 19
- TypeScript
- Vite 6 (build tool, dev server on port 5000)
- Express (backend API on port 3001)
- Tailwind CSS (via CDN)
- Google Gemini AI (@google/genai)

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
5. Frontend receives file URI, sends to `/api/analyze` with project metadata
6. Backend uses `createPartFromUri` to reference video in Gemini request
7. Maximum video size: 2GB (enforced on frontend and backend)

### Polling Strategy
- Initial delay: 1 second
- Backoff factor: 1.5x per attempt
- Maximum delay: 10 seconds (capped)
- Jitter: ±20% randomization (500ms floor)
- Hard timeout: 10 minutes

### Analysis Response Schema
The `/api/analyze` endpoint returns a structured report with:
- `summary`: Executive critical summary (300-500 words)
- `highlights`: Array of 5 positive moments with:
  - timestamp, seconds, summary, why_it_works, category (emotion/craft/clarity/marketability)
- `concerns`: Array of 5 critical issues with:
  - timestamp, seconds, issue, impact, severity (1-5), category, suggested_fix
- `answers`: Responses to user-defined research objectives

Server-side validation enforces:
- Exactly 5 highlights and 5 concerns expected (logs warning if violated)
- Severity clamped to 1-5 range
- At least 3 concerns should have severity >= 3

## Development
- Run: `npm run dev` (starts both frontend and backend concurrently)
- Frontend only: `vite`
- Backend only: `npm run server`
- Build: `npm run build`

## Environment Variables
- `GEMINI_API_KEY` - Required Gemini API key (stored as secret, used by backend only)

## Deployment
Autoscale deployment - builds frontend with Vite, serves via Express backend.

## Recent Changes
- Implemented exponential backoff polling with jitter for Gemini processing status
- Implemented resumable upload with 16MB chunks and offset reconciliation
- Fixed server binding to 0.0.0.0 for reliable Vite proxy connection
- Bypassed express.json() for upload route to prevent memory buffering
- Added memory logging and graceful shutdown handlers
- Separated highlights/concerns with explicit rubric and severity scoring
- Added server-side validation for response schema
