# FocalPoint AI

## Overview
FocalPoint AI is a React + TypeScript + Vite application designed for professional indie creators. It offers advanced multimodal focus groups by leveraging Google's Gemini AI to analyze video content. The platform employs multiple configurable AI personas, each providing a distinct professional perspective on the video analysis. The core purpose is to provide creators with comprehensive feedback through AI-generated reports, innovative voice notes, and podcast-style dialogues between AI reviewers.

## User Preferences
Not specified.

## System Architecture
FocalPoint AI utilizes a React 19 frontend with TypeScript and Vite 6, communicating with an Express backend. The application is designed for asynchronous video processing, robust error handling, and a modular multi-persona analysis system.

### UI/UX Decisions
- **Technology**: React, TypeScript, Tailwind CSS (via PostCSS with @tailwindcss/postcss) for styling.
- **Typography**: Inter + Noto Sans TC font stack for broad language support, especially CJK.
- **Design Approach**: Focus on a responsive and intuitive interface for video uploads, persona selection, and report viewing.

### Technical Implementations
- **Frontend**: Vite dev server on port 5000.
- **Backend**: Express server on port 3001, binding to 0.0.0.0.
- **API Proxy**: Vite proxies `/api` requests to the Express backend.
- **Security**: API keys stored as secrets (`GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `ELEVENLABS_API_KEY`) and never exposed to the frontend.
- **Correlation IDs**: All API requests include a UUID `X-Request-Id` header for end-to-end tracing. Frontend generates IDs via `client/api.ts`, backend propagates them via `server/middleware/requestId.ts`, and outbound calls are logged via `server/utils/fetchWithTrace.ts`. Error messages include truncated request IDs (e.g., "Ref: abc12345") for debugging.
- **Error Serialization**: All errors are properly serialized using `serializeError()` to capture `name`, `message`, `stack`, and `cause` (no more `{}` in logs).
- **Video Input** (Two Options):
    - **Option A - YouTube URL**: Paste a public YouTube URL directly. Gemini analyzes the video without upload/compression. Benefits: No upload time, no file size limits, no 48-hour expiration. Limitations: Video must be public, 8-hour daily processing limit.
    - **YouTube URL Validation**: Real-time validation using YouTube Data API v3 to check video privacy status. Unlisted and private videos are rejected with clear error messages before analysis begins. Falls back to oEmbed if API key is not configured.
    - **Option B - Direct Upload** (AI Proxy Architecture):
        - **Four-Stage Flow**: Browser uploads to Object Storage, server compresses to 720p/10fps "analysis proxy", then transfers proxy to Gemini.
        - **Stage 1 - Storage Upload** (0-40%): Frontend requests presigned PUT URL via `/api/uploads/init`, uploads directly via XMLHttpRequest.
        - **Stage 2 - Compression** (40-75%): Server downloads original, compresses to 720p/10fps using FFmpeg (CRF 28, mono audio), stores proxy in Object Storage.
        - **Stage 3 - Gemini Transfer** (75-95%): Server uploads compressed proxy to Gemini File API in 16MB chunks.
        - **Stage 4 - Ready** (100%): Gemini processes file until ACTIVE state.
        - **Benefits**: Dramatically faster Gemini transfers (50-100x smaller files), reduced API costs, original preserved for playback.
        - **Status Polling**: Frontend polls `/api/uploads/status/:uploadId` for progress updates with exponential backoff.
        - **Idempotency**: Same `attemptId` returns same `uploadId`/presigned URL for retry support.
        - **Size Verification**: Server verifies uploaded file size matches declared size (hard failure on mismatch >1KB).
        - **MIME Type Preservation**: Actual file MIME type flows through entire pipeline.
        - **Presigned URL TTL**: 15 minutes for upload completion.
        - **Database Tracking**: `uploads` table tracks state machine: UPLOADING → STORED → COMPRESSING → COMPRESSED → TRANSFERRING_TO_GEMINI → ACTIVE (or FAILED). Fields include `proxyStorageKey` and `proxySizeBytes` for the compressed proxy.
        - Maximum video size: 2GB.
- **YouTube Player Integration**:
    - Uses YouTube IFrame Player API for embedded playback in ScreeningRoom.
    - Supports `seekTo()` for timecode navigation when clicking highlights/concerns.
    - YouTube URL validation regex: `^https?://(www.)?(youtube.com/watch?v=|youtu.be/)[a-zA-Z0-9_-]{11}`.
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
    - `sessions` table: Stores video metadata (fileUri or youtubeUrl), user questions, language, and persona aliases.
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
- **YouTube Data API v3**: Used for real-time validation of YouTube video privacy status. Checks if videos are public, unlisted, or private before allowing analysis.
- **PostgreSQL**: Relational database for session and report persistence.
- **Drizzle ORM**: TypeScript ORM for interacting with PostgreSQL.
- **ElevenLabs**: Third-party API for text-to-speech audio generation.
    - `eleven_v3` model for English voice notes (supports audio tags).
    - `eleven_multilingual_v2` model for zh-TW voice notes.
    - Text-to-Dialogue API for podcast generation (English only).
- **Replit Object Storage**: Used for direct-to-storage video uploads and generated audio files (voice notes and podcast dialogues).

## Key Files

### Server (Modular Route Structure)
- `server/index.ts` - Express server entry point (~175 lines, mounts all route modules)
- `server/routes/sessions.ts` - Session CRUD endpoints, YouTube URL validation
- `server/routes/reports.ts` - Report get/save endpoints
- `server/routes/voice.ts` - Voice script generation, audio streaming
- `server/routes/analyze.ts` - Video analysis endpoint
- `server/uploadRoutes.ts` - Direct-to-storage upload endpoints and Gemini transfer logic
- `server/middleware/validation.ts` - Shared input validation middleware
- `server/middleware/rateLimiting.ts` - Rate limiting configuration
- `server/utils/personaAliases.ts` - Persona alias generation utility

### Server Services
- `server/services/videoCompressor.ts` - FFmpeg video compression (720p, 10fps, CRF 28)
- `server/voiceScriptService.ts` - Voice script generation pipeline
- `server/elevenLabsService.ts` - ElevenLabs API integration for TTS and dialogues
- `server/dialogueService.ts` - Podcast dialogue script generation
- `server/personas.ts` - AI persona configurations
- `server/geminiService.ts` - Gemini AI integration

### Frontend Components
- `components/ScreeningRoom.tsx` - Main session view component (~720 lines)
- `components/HighlightCard.tsx` - Highlight display with HighlightsList
- `components/ConcernCard.tsx` - Concern display with ConcernsList
- `components/YouTubePlayer.tsx` - YouTube IFrame Player API integration with seekTo() support
- `components/ui/ExpandableContent.tsx` - Truncated text with expand/collapse
- `components/ui/reportHelpers.ts` - Category icons, formatters
- `components/VoicePlayer.tsx` - Voice note playback UI
- `components/ReviewerPairPicker.tsx` - Podcast persona selection UI
- `components/DialoguePlayer.tsx` - Podcast dialogue playback UI

### Shared
- `shared/schema.ts` - Database schema definitions (Drizzle ORM)
