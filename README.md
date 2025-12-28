# FocalPoint AI

Professional multimodal video analysis for indie filmmakers using Google's Gemini AI.

FocalPoint AI provides focus group-style feedback through configurable AI personas, each offering a distinct professional perspective on your film. Get timestamped observations, critical summaries, and answers to your specific research questions.

## Features

- **On-Demand Persona Analysis** - Select one reviewer to start, add more after viewing the first report. Only pay for the analyses you need.
- **Large Video Support** - Upload videos up to 2GB using resumable chunked uploads (16MB chunks).
- **Timestamped Feedback** - Every highlight and concern links to the exact moment in your video.
- **Structured Reports** - Executive summary, 5 highlights, 5 concerns with severity ratings, and answers to your research questions.
- **Multi-Language Output** - Analysis reports can be generated in English or Traditional Chinese (Taiwan).
- **Cached Reports** - Switch between generated persona reports instantly.
- **Secure API Handling** - Gemini API key stays on the backend, never exposed to the client.

## Personas

| Persona | Role | Focus |
|---------|------|-------|
| **Acquisitions Director** | Senior Acquisitions Director | Commercial viability, pacing, marketability, distribution potential |
| **Cultural Editor** | Cultural Editor | Cultural relevance, emotional resonance, authorship, audience engagement |

Each persona has unique:
- System instruction defining identity and critical lens
- Highlight categories (e.g., emotion, craft, clarity, marketability)
- Concern categories (e.g., pacing, tone, audio, visual)
- Minimum high-severity concern thresholds

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS
- **Backend**: Express.js, Node.js
- **AI**: Google Gemini API (`gemini-3-flash-preview` model)
- **File Handling**: Multer (disk storage), resumable upload protocol

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Port 5000)                     │
│  React + Vite                                                   │
│  ├── UploadForm (single persona selection)                      │
│  ├── ProcessingQueue (upload + analysis status)                 │
│  └── ScreeningRoom (reports, video player, Add Reviewer)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ /api/* (proxied)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (Port 3001)                      │
│  Express.js                                                     │
│  ├── POST /api/upload    → Resumable upload to Gemini File API  │
│  ├── POST /api/analyze   → Generate report with selected persona│
│  ├── GET  /api/personas  → List available personas              │
│  └── GET  /api/health    → Health check                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Google Gemini API                           │
│  ├── File API (resumable upload, 48hr retention)                │
│  └── generateContent (video + prompt → structured JSON)         │
└─────────────────────────────────────────────────────────────────┘
```

## Video Upload Flow

1. Frontend uploads video via `POST /api/upload`
2. Backend saves to disk with Multer (avoids memory buffering)
3. Backend streams to Gemini in 16MB chunks using resumable protocol
4. Backend polls Gemini with exponential backoff until video is `ACTIVE`
5. Frontend receives `fileUri` and caches it for reuse across persona analyses
6. Subsequent persona analyses reuse the same `fileUri` (no re-upload)

## API Endpoints

### `POST /api/upload`
Upload a video file for analysis.

**Request**: `multipart/form-data` with `video` field

**Response**:
```json
{
  "fileUri": "https://generativelanguage.googleapis.com/v1beta/files/abc123",
  "fileMimeType": "video/mp4",
  "fileName": "files/abc123"
}
```

### `POST /api/analyze`
Analyze video with selected persona(s).

**Request**:
```json
{
  "title": "My Film",
  "synopsis": "A story about...",
  "srtContent": "Optional dialogue context",
  "questions": ["Is this ready for festivals?"],
  "language": "en",
  "fileUri": "https://...",
  "fileMimeType": "video/mp4",
  "personaIds": ["acquisitions_director"]
}
```

**Response**:
```json
{
  "results": [{
    "personaId": "acquisitions_director",
    "status": "success",
    "report": {
      "executive_summary": "...",
      "highlights": [
        { "timestamp": "02:34", "seconds": 154, "summary": "...", "why_it_works": "...", "category": "emotion" }
      ],
      "concerns": [
        { "timestamp": "05:12", "seconds": 312, "issue": "...", "impact": "...", "severity": 4, "category": "pacing", "suggested_fix": "..." }
      ],
      "answers": [
        { "question": "Is this ready for festivals?", "answer": "..." }
      ]
    }
  }]
}
```

### `GET /api/personas`
List available personas with metadata.

### `GET /api/health`
Health check endpoint.

## Prompt Architecture

Each persona has two prompt components:

### System Instruction
Defines the AI's identity, critical lens, and communication style. Example for Acquisitions Director:
- Identity: Senior Acquisitions Director at indie film distributor
- Lens: Commercial viability, pacing, marketability
- Critical stance: No-nonsense, direct assessments

### User Prompt
Provides the analysis task with:
- Film title and synopsis
- Dialogue context (first 5000 chars of SRT)
- User-defined research questions
- Strict requirements: exactly 5 highlights, exactly 5 concerns
- Category constraints per persona
- Minimum high-severity concern thresholds

### Response Schema
Gemini returns structured JSON enforced by schema:
```typescript
{
  executive_summary: string,           // 300-500 word critical memo
  highlights: Array<{
    timestamp: string,                 // "MM:SS" format
    seconds: number,                   // For video seeking
    summary: string,
    why_it_works: string,
    category: string                   // From persona's highlight categories
  }>,
  concerns: Array<{
    timestamp: string,
    seconds: number,
    issue: string,
    impact: string,
    severity: number,                  // 1-5 scale
    category: string,                  // From persona's concern categories
    suggested_fix: string
  }>,
  answers: Array<{
    question: string,
    answer: string
  }>
}
```

## Setup

### Prerequisites
- Node.js 18+
- Gemini API key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/focalpoint-ai.git
   cd focalpoint-ai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set your Gemini API key as an environment variable:
   ```bash
   export GEMINI_API_KEY=your_api_key_here
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5000 in your browser.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend concurrently |
| `npm run server` | Start backend only |
| `npm run build` | Build frontend for production |

## File Structure

```
├── App.tsx                 # Main React component, state management
├── index.tsx               # React entry point
├── index.html              # HTML template
├── geminiService.ts        # Frontend API client
├── types.ts                # TypeScript type definitions
├── constants.tsx           # Persona display data, random name generator
├── components/
│   ├── Button.tsx          # Reusable button component
│   ├── UploadForm.tsx      # Project intake form
│   ├── ProcessingQueue.tsx # Upload/analysis progress UI
│   └── ScreeningRoom.tsx   # Report viewing, video player, Add Reviewer
├── server/
│   ├── index.ts            # Express server, API routes, Gemini integration
│   └── personas.ts         # Persona configs with full prompts
├── replit.md               # Project documentation for Replit
└── README.md               # This file
```

## Limits

- Maximum video size: 2GB
- Video retention on Gemini: 48 hours
- Highlights per report: 5 (enforced)
- Concerns per report: 5 (enforced)
- Severity scale: 1-5 (clamped and validated)

## License

MIT
