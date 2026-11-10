# DecisionFlow

**Real-Time Meeting Decision Intelligence & Accountability** (final-year major project, Batch 16).

DecisionFlow listens to a meeting, shows a live transcript, uses AI to pull out decisions, action items, owners,
deadlines, blockers and open questions, keeps a searchable decision history across meetings, and flags when a new
decision conflicts with or changes an earlier one, so a person can review it.

- Full design: [docs/SPEC.md](docs/SPEC.md)
- Build steps and Cursor prompts: [docs/CURSOR_BUILD_GUIDE.md](docs/CURSOR_BUILD_GUIDE.md)

## Tech stack

React + Vite + Tailwind (client) · Node.js + Express + Socket.IO (server) · SQLite file database (better-sqlite3)
· Browser Web Speech API (speech-to-text) · Claude API or free mock mode (AI). **No Docker, no database server.**

## Requirements

- Node.js 20 or newer (LTS recommended)
- Google Chrome or Microsoft Edge (needed for the microphone speech recognition)

## Run it

```bash
npm run install:all
```

Copy `server/.env.example` to `server/.env`. It works as-is in **mock** AI mode. To use the real AI, set
`AI_MODE=claude` and put your key in `ANTHROPIC_API_KEY`.

```bash
npm run dev
```

Open the address that Vite prints in the terminal. It's usually **http://localhost:5173**, or **5174** if 5173 is
already used by another app. Then register an account and create a project.

- Server (API + live updates): http://localhost:4000. The client forwards `/api` and `/socket.io` to it.
- Database: `server/data/decisionflow.db`. It's created automatically. Delete it to start fresh.

## Folder structure

```
server/     Express API, Socket.IO, SQLite schema, AI services
client/     React app (pages, components)
demo/       Demo meeting scripts used for live demos
docs/       Specification, build guide, architecture docs
```

`_old_java_version/` is the earlier Java/Spring Boot attempt, kept only for reference. You can delete it.
