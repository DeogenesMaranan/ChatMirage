# ChatMirage

Randomized 1-to-1 chats that secretly pair people with either another human or a lightweight AI persona, then prompt them to decide who was on the other side. Built with Node.js, Express, Socket.io, and the Gemini API.

## Table of Contents
1. [Key Features](#key-features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start — User Guide](#quick-start--user-guide)
5. [Using the App](#using-the-app)
6. [Environment Variables](#environment-variables)
7. [REST & Socket Surface](#rest--socket-surface)
8. [Developer Guide](#developer-guide)
9. [Data & Persistence](#data--persistence)
10. [Troubleshooting](#troubleshooting)

## Key Features
- Anonymous matchmaking with seamless fallback to an AI partner when no human is available.
- Built-in Turing Test moment: after enough messages the UI asks users to guess whether they chatted with a human or AI.
- Confusion-matrix tracking of guesses, surfaced via `/api/guess-stats` and in the landing page stats cards.
- AI partners powered by Google Gemini with lightweight persona randomization and short, casual responses.
- Modern single-page UI (Tailwind + vanilla JS) with typing indicators, resume support, and a debug toggle.

## Architecture
- **server.js / src/index.js** bootstraps Express + Socket.io, loads env vars, and starts the HTTP server.
- **src/app.js** exposes `createServer()`, serves the static frontend, and implements the `/api/guess-stats` endpoint by reading `data/guesses.json`.
- **src/sessionManager.js** contains the matchmaking finite state machine, socket event handlers, queue management, typing indicators, thresholds for prompting guesses, and persistence hooks.
- **src/ai.js** wraps Google Gemini (`@google/generative-ai`) to create short, human-like replies using randomized personalities.
- **public/** hosts the Tailwind-based frontend (`index.html`, `app.js`) that orchestrates the chat UI, socket events, overlay/modals, and community stats.

## Prerequisites
- Node.js 18+ (for fetch, crypto APIs, and ES2022 features used in dependencies)
- npm 9+
- A Google Gemini API key with access to the configured model.

## Quick Start — User Guide
1. **Clone & install**
   ```powershell
   git clone <repo-url>
   cd ChatMirage
   npm install
   ```
2. **Configure environment** — copy `.env.example` (create it if missing) and set at least:
   ```env
   GEMINI_API_KEY=your-key
   GEMINI_MODEL=gemini-2.5-flash # optional, defaults to gemini-2.5-flash
   PORT=3000                     # optional override
   ```
3. **Run the server**
   ```powershell
   npm start
   ```
4. **Open the app** — visit `http://localhost:3000`.
5. **Stop** — `Ctrl+C` in the terminal when done.

## Using the App
- **Start chat** via *Start Chat*. The UI shows a searching overlay while matching.
- **Force an AI partner** with *Demo (force AI)*, useful for demos or offline testing.
- **Chat**: messages appear as bubbles; typing indicators show partner activity.
- **Guess prompt**: after enough messages you must guess Human vs AI. Pick an option; you may continue or end the chat afterward.
- **Skip partner** any time with *Skip* (resets queue and looks for another match).
- **Landing stats** summarize community guess accuracy using the confusion matrix stored in `data/guesses.json`.
- **Debug toggle** (header) reveals your `userId`, `sessionId`, and partner type to help diagnose state issues.

## Environment Variables
| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Express/Socket.io port. |
| `GEMINI_API_KEY` | — | Required; API key for Google Generative AI. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model identifier passed to `getGenerativeModel`. |
| `HUMAN_MESSAGE_THRESHOLD` | `5` | Number of human messages before triggering guess prompt. |
| `MESSAGE_THRESHOLD` | `10` | Total messages between repeated prompts. |
| `TYPING_INDICATOR_DELAY_MS` | `500` | Delay before emitting typing indicator events. |
| `TYPING_INDICATOR_JITTER_MS` | `200` | Random jitter for typing indicator start. |
| `WAITING_TIMEOUT_MS` | `30000` | Time before falling back to AI when no human partner is found. |
| `WAITING_TIMEOUT_JITTER_MS` | `5000` | Jitter on waiting timeout; avoids synchronized fallbacks. |
| `AI_PRE_TYPING_DELAY_MS` | `600` | Delay before AI shows typing, simulating deliberation. |
| `AI_PRE_TYPING_JITTER_MS` | `300` | Jitter for AI typing delay. |

Tip: Create an `.env` file at the repo root so `dotenv` loads it automatically.

## REST & Socket Surface
### REST
- `GET /api/guess-stats` → `{ total, TP, FP, FN, TN }` derived from `data/guesses.json`.

### Socket Events (subset)
| Event | Direction | Payload | Notes |
| --- | --- | --- | --- |
| `paired` | server→client | `{ sessionId, partnerType }` | Sent when matched; `partnerType` is `human`, `ai`, or `waiting`.
| `chat_message` | bidirectional | `{ text, from }` | Basic chat transport; client distinguishes `me` vs `partner`.
| `typing` / `stop_typing` | client→server | `{ sessionId }` | Throttled typing indicator state. |
| `partner_typing` / `partner_stop_typing` | server→client | `{ userId }` | Mirrors typing status to the recipient. |
| `turing_prompt` | server→client | `{ prompt }` | Instructs client to ask for a guess. |
| `submit_guess` | client→server | `{ sessionId, guess }` | User guess (Human/AI). |
| `post_guess_options` | server→client | `{ message }` | Allows users to continue or end after guessing. |
| `submit_continue_choice` | client→server | `{ choice }` | `continue` or `end`. |
| `chat_ended` | server→client | `{ reason, partnerType, message }` | Always reveals partner type at the end. |

## Developer Guide
### Project Layout
```
ChatMirage/
├─ server.js              # entry: requires src/index.js
├─ src/
│  ├─ index.js            # dotenv load + server bootstrap
│  ├─ app.js              # Express + Socket.io factory + REST endpoint
│  ├─ sessionManager.js   # matchmaking, sockets, persistence
│  └─ ai.js               # Gemini integration & persona selection
├─ public/
│  ├─ index.html          # Tailwind UI shell
│  └─ app.js              # Client-side state + socket orchestration
├─ data/
│  └─ guesses.json        # Confusion-matrix records (JSON array)
└─ package.json
```

### Runtime Flow
1. `npm start` runs `server.js`, which imports `src/index.js`.
2. `src/index.js` loads env vars, calls `createServer()`, and hands the resulting `io` instance to `sessionManager.init()`.
3. `sessionManager` registers all socket event listeners, handles matchmaking, and proxies AI requests via `aiRespond()` when needed.
4. The browser loads `public/index.html` and `public/app.js`, connects via Socket.io, and reacts to server events.
5. Guess outcomes are appended to `data/guesses.json`, which `src/app.js` reads to populate the landing-page stats.

### AI Integration Notes
- `src/ai.js` randomly picks a persona from `PERSONALITIES` per response, keeping replies short (1–2 sentences) with casual tone.
- Errors while calling Gemini are caught; the socket handler stops typing indicators and logs the error but keeps the session alive.
- To swap models, change `GEMINI_MODEL` or update `ai.js` to support streaming responses if needed.

### Matchmaking & Sessions
- Humans are queued in `waitingQueue`. If another human joins before the timeout, they are paired; otherwise they fall back to AI.
- Each session tracks `chatHistory`, `guessHistory`, confusion stats, and `partnerIsAI`.
- Guess prompts trigger when `HUMAN_MESSAGE_THRESHOLD` messages have been sent per participant or every `MESSAGE_THRESHOLD` total messages.
- Typing indicator jitter is configurable to avoid synchronized UI artifacts.

### Frontend Behavior
- `public/app.js` is vanilla JS with Tailwind classes. It persists `sessionId` and `partnerType` in `localStorage` to resume disconnected chats.
- Landing stats call `/api/guess-stats`. Debug toggle reveals IDs, and demo mode sets `window.__forcePartner = 'ai'` before connecting.
- Typing indicator UI is implemented manually with DOM nodes plus a small injected keyframe animation.

### Dev Tips
- Run `npm install --save-dev nodemon` and use `nodemon server.js` for hot reloads if desired.
- When testing AI fallbacks deterministically, set `WAITING_TIMEOUT_MS=0` or click *Demo (force AI)*.
- To inspect stored guesses, open `data/guesses.json`; delete the file to reset stats (it will be recreated on next write).
- Keep your Gemini key out of source control; use `.env` or Windows Credential Manager.

## Data & Persistence
- Guess records live in `data/guesses.json`; the session manager appends asynchronously, so high write volume may require migrating to a database.
- The API calculates TP/FP/FN/TN totals at request time to keep the stored data append-only.
- No other server-side persistence is used; session state lives in-memory, so restarting the server drops active chats.

## Troubleshooting
- **`npm start` exits immediately**: ensure `.env` is readable and `GEMINI_API_KEY` is set; check the `node` terminal logs.
- **Sockets fail to connect**: confirm the port (default 3000) is reachable; if testing through `cloudflared`, run the tunnel after the server is up.
- **AI replies are blank**: verify the Gemini quota and model availability; inspect server logs for `AI generation error` entries.
- **Stale stats**: delete `data/guesses.json` when resetting; the endpoint recalculates totals on the next request.
- **Typing indicator stuck**: the frontend removes the bubble when `partner_stop_typing` is received; confirm the event is emitted by checking the debug panel.

Happy testing, and may your guesses be accurate!