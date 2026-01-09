# FocalPoint AI

## Overview
FocalPoint AI is a React + TypeScript + Vite application designed for professional indie creators. It offers advanced multimodal focus groups by leveraging Google's Gemini AI to analyze video content. The platform employs multiple configurable AI personas, each providing a distinct professional perspective on the video analysis. The core purpose is to provide creators with comprehensive feedback through AI-generated reports, innovative voice notes, and podcast-style dialogues between AI reviewers.

## User Preferences
Not specified.

## System Architecture
FocalPoint AI utilizes a React 19 frontend with TypeScript and Vite 6, communicating with an Express backend. The application is designed for asynchronous video processing, robust error handling, and a modular multi-persona analysis system.

### UI/UX Decisions
- **Technology**: React, TypeScript, Tailwind CSS (via CDN) for styling.
- **Typography**: Inter + Noto Sans TC font stack for broad language support, especially CJK.
- **Design Approach**: Focus on a responsive and intuitive interface for video uploads, persona selection, and report viewing.

### Technical Implementations
- **Frontend**: Vite dev server on port 5000.
- **Backend**: Express server on port 3001, binding to 0.0.0.0.
- **API Proxy**: Vite proxies `/api` requests to the Express backend.
- **Security**: Gemini API key stored as a secret (`GEMINI_API_KEY`) and never exposed to the frontend.
- **Video Upload** (Direct-to-Storage Architecture):
    - **Three-Stage Flow**: Browser uploads directly to Object Storage via presigned URL, then server transfers to Gemini in background.
    - **Stage 1 - Storage Upload**: Frontend requests presigned PUT URL via `/api/uploads/init`, then uploads directly using XMLHttpRequest with progress events (0-40% UI progress).
    - **Stage 2 - Preparing**: After upload completes, frontend calls `/api/uploads/complete` to verify size, then server transfers to Gemini File API in 16MB chunks (40-95% UI progress).
    - **Stage 3 - Ready**: Gemini processes file until ACTIVE state (100% UI progress).
    - **Status Polling**: Frontend polls `/api/uploads/status/:uploadId` for progress updates with exponential backoff.
    - **Idempotency**: Same `attemptId` returns same `uploadId`/presigned URL for retry support.
    - **Size Verification**: Server verifies uploaded file size matches declared size (hard failure on mismatch >1KB).
    - **MIME Type Preservation**: Actual file MIME type flows through entire pipeline.
    - **Presigned URL TTL**: 15 minutes for upload completion.
    - **Database Tracking**: `uploads` table tracks state machine: UPLOADING → STORED → TRANSFERRING_TO_GEMINI → ACTIVE (or FAILED).
    - Maximum video size: 2GB.
- **Persona System**:
    - **"House Style + Persona Edge" pattern**: Shared `HOUSE_STYLE_GUIDELINES`, `OUTPUT_CONSTRAINTS_REMINDER`, and `SUMMARY_READABILITY_GUIDELINES` ensure consistent tone and formatting across all persona analyses, while `RAW_PERSONA_CONFIGS` define unique aspects.
    - Each persona has a unique system instruction, user prompt template, highlight categories, concern categories, and minimum high-severity concern thresholds.
    - Individual persona failures are isolated to prevent blocking other results.
    - Available personas include `acquisitions_director`, `cultural_editor`, `mass_audience_viewer`, and `social_impact_viewer`.
- **Analysis Polling**:
    - Exponential backoff strategy (1s initial, 1.5x factor, 10s max delay) with ±20% jitter.
    - Hard timeout of 10 minutes for analysis.
- **Report Structure**: Each persona report includes an executive summary, 5 highlights with timestamps, 5 concerns with severity and suggested fixes, and answers to user-defined research objectives. Server-side validation ensures report integrity.
- **Reviewer Voice Notes**:
    - **Three-Pass Pipeline**:
        - **Pass A (Deterministic Coverage)**: Generates a structured draft ensuring coverage of all highlights and concerns.
        - **Pass B (Conversational Naturalization)**: Uses LLM to rewrite draft into natural, speech-native text, adhering to specific linguistic rules for English and zh-TW.
        - **Audio Generation**: Utilizes ElevenLabs for text-to-speech conversion.
    - **Personalized Opening/Closing Lines**: LLM generates 2 opening + 2 closing line options tailored to each persona's role, voice style, and the specific report content. Falls back to generic lines on error.
    - **Language-Specific Voice Models**:
        - **English**: Uses `eleven_v3` model with stability=0.0 for natural variation. Supports audio tags for emotional direction (e.g., `<chuckle>`, `<sigh>`).
        - **繁體中文 (zh-TW)**: Uses `eleven_multilingual_v2` model with stability=0.5 for smoother Chinese speech. Audio tags are stripped as v2 does not support them.
    - Supports both English and zh-TW with specific naturalization rules per language.
- **Podcast Dialogue** (English Only):
    - **Two-Reviewer Conversation**: Generates natural dialogue between two selected AI personas discussing a video's analysis.
    - **Dialogue Script Generation**: LLM creates a conversational script with speaker turns, references to highlights/concerns, and audio emotion tags.
    - **ElevenLabs Text-to-Dialogue API**: Uses ElevenLabs' dialogue endpoint to generate a single audio file with distinct voices for each participant.
    - **Language Restriction**: Only available for English sessions. ElevenLabs' text-to-dialogue API does not support non-English languages. UI shows "English Only" badge and explanatory message for zh-TW sessions.
    - **Regeneration Support**: Users can regenerate podcast dialogue with the same reviewer pair, with existing audio preserved during regeneration.
    - **Job-Based Processing**: Dialogue generation runs asynchronously with status polling. Jobs are persisted in `dialogueJobs` table.

### Feature Specifications
- **Multi-Persona Analysis**: Users can select one persona initially and add more later without re-uploading the video, leveraging cached `fileUri`.
- **Real-time Progress**: Upload and analysis progress displayed in real-time.
- **Session Management**: PostgreSQL + Drizzle ORM for persisting sessions and reports. This includes creating, listing, retrieving, updating, and deleting sessions and associated reports.
- **Voice Script Generation**: Generate and cache voice scripts for reports, with optional audio generation via ElevenLabs.
- **Podcast Dialogue Generation**: Generate two-reviewer podcast-style conversations from existing reports (English only).

### System Design Choices
- **Database**: PostgreSQL with Drizzle ORM for data persistence.
    - `sessions` table: Stores video metadata, user questions, language, and persona aliases.
    - `reports` table: Stores detailed analysis reports for each persona.
    - `voice_scripts` table: Caches generated voice scripts and audio URLs.
    - `dialogue_jobs` table: Tracks podcast dialogue generation jobs, including persona pairs, script JSON, audio storage keys, and job status.
    - `uploads` table: Tracks direct-to-storage video uploads with state machine (uploadId, storageKey, status, geminiFileUri, progress).
- **Security**:
    - `express-rate-limit` for API endpoints (e.g., upload, status, analyze).
    - CORS restrictions tailored for production (`*.repl.co`, `*.replit.dev`, `*.replit.app`) and development (`localhost:5000`).
    - Robust input validation for all API endpoints.
    - File upload validation for MIME types and size.
    - Generic error messages for clients, detailed logging server-side.

## External Dependencies
- **Google Gemini AI**: Used for video analysis, specifically the `gemini-3-pro-preview` model.
- **PostgreSQL**: Relational database for session and report persistence.
- **Drizzle ORM**: TypeScript ORM for interacting with PostgreSQL.
- **ElevenLabs**: Third-party API for text-to-speech audio generation.
    - `eleven_v3` model for English voice notes (supports audio tags).
    - `eleven_multilingual_v2` model for zh-TW voice notes.
    - Text-to-Dialogue API for podcast generation (English only).
- **Replit Object Storage**: Used for direct-to-storage video uploads and generated audio files (voice notes and podcast dialogues).

## Key Files
- `server/index.ts` - Express server entry point with all API routes
- `server/voiceScriptService.ts` - Voice script generation pipeline
- `server/elevenLabsService.ts` - ElevenLabs API integration for TTS and dialogues
- `server/dialogueService.ts` - Podcast dialogue script generation
- `server/personas.ts` - AI persona configurations
- `shared/schema.ts` - Database schema definitions
- `components/ScreeningRoom.tsx` - Main session view component
- `components/VoicePlayer.tsx` - Voice note playback UI
- `components/ReviewerPairPicker.tsx` - Podcast persona selection UI
- `components/DialoguePlayer.tsx` - Podcast dialogue playback UI
- `server/uploadRoutes.ts` - Direct-to-storage upload endpoints and Gemini transfer logic
