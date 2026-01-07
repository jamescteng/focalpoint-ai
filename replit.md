# FocalPoint AI

## Overview
FocalPoint AI is a React + TypeScript + Vite application designed for professional indie creators. It offers advanced multimodal focus groups by leveraging Google's Gemini AI to analyze video content. The platform employs multiple configurable AI personas, each providing a distinct professional perspective on the video analysis. The core purpose is to provide creators with comprehensive feedback through AI-generated reports and innovative voice notes, enhancing their content creation process.

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
- **Video Upload**:
    - Asynchronous, job-based architecture with immediate response upon file reception.
    - Busboy for streaming multipart parsing.
    - Temporary spool files for incoming video streams.
    - Background processing for uploading to Gemini in 16MB chunks (resumable upload).
    - Frontend polls for real-time status updates.
    - In-memory job store with TTL for tracking upload status.
    - Upload idempotency using `X-Upload-Attempt-Id` header to prevent re-uploads.
    - Stale job recovery mechanism for abandoned uploads.
    - Automatic retry logic (up to 3 times) for connection errors during upload.
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
        - **Audio Generation**: Utilizes ElevenLabs v3 with audio tags for emotional direction.
    - Supports both English and zh-TW with specific rules for naturalization.

### Feature Specifications
- **Multi-Persona Analysis**: Users can select one persona initially and add more later without re-uploading the video, leveraging cached `fileUri`.
- **Real-time Progress**: Upload and analysis progress displayed in real-time.
- **Session Management**: PostgreSQL + Drizzle ORM for persisting sessions and reports. This includes creating, listing, retrieving, updating, and deleting sessions and associated reports.
- **Voice Script Generation**: Generate and cache voice scripts for reports, with optional audio generation via ElevenLabs.

### System Design Choices
- **Database**: PostgreSQL with Drizzle ORM for data persistence.
    - `sessions` table: Stores video metadata, user questions, and language.
    - `reports` table: Stores detailed analysis reports for each persona.
    - `voice_scripts` table: Caches generated voice scripts and audio URLs.
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
- **ElevenLabs**: Third-party API for text-to-speech audio generation using `eleven_v3` model.
- **Replit Object Storage**: Used for storing generated audio files.