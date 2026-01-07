# FocalPoint AI

Professional multimodal video analysis for indie filmmakers using Google's Gemini AI.

Get focus group-style feedback through configurable AI personas, each offering a distinct professional perspective on your film. Every report includes timestamped highlights, concerns with severity ratings, and answers to your research questions.

## Features

- **On-Demand Persona Analysis** - Select one reviewer to start, add more after viewing
- **Large Video Support** - Upload videos up to 2GB with streaming uploads
- **Timestamped Feedback** - Every observation links to the exact moment
- **Structured Reports** - Executive summary, 5 highlights, 5 concerns, research answers
- **Multi-Language** - English or Traditional Chinese output
- **Secure** - API keys stay on the backend with rate limiting and input validation

## Personas

| Persona | Focus |
|---------|-------|
| **Acquisitions Director** | Commercial viability, pacing, marketability |
| **Cultural Editor** | Cultural relevance, emotional resonance, authorship |
| **Mass Audience Viewer** | Clarity, engagement, drop-off risk |
| **Social Impact Viewer** | Message clarity, ethical storytelling, trust |

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js with Busboy streaming
- **AI**: Google Gemini API (`gemini-3-pro-preview`)

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set your Gemini API key:
   ```bash
   export GEMINI_API_KEY=your_key_here
   ```

3. Run:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5000

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/upload` | Upload video, returns fileUri |
| `POST /api/analyze` | Analyze video with selected personas |
| `GET /api/personas` | List available personas |
| `GET /api/health` | Health check |

## Limits

- Maximum video size: 2GB
- Video retention on Gemini: 48 hours
- 5 highlights + 5 concerns per report (enforced)

## License

MIT
