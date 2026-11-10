# DecisionFlow

**Real-Time Meeting Decision Intelligence & Accountability**

DecisionFlow turns a live meeting into decisions, action items, blockers and open questions. It saves a searchable history across meetings, flags when a new decision changes or conflicts with an older one, and lets a human accept or reject that flag before anything is updated.

Works with **no AI API key** (`AI_MODE=mock`). Optional Claude key for higher-quality extraction.

---

## Clone → run → demo (about 5 minutes)

### 1. Requirements

- **Node.js 20 LTS** or newer (`node -v`)
- **npm** (comes with Node)
- **Chrome or Edge** if you want microphone demos (optional — Demo script mode does not need a mic)

### 2. Install

```bash
git clone <your-repo-url>
cd decisionflow
npm run install:all
```

### 3. Configure

```bash
# Windows (PowerShell / cmd)
copy server\.env.example server\.env

# macOS / Linux
cp server/.env.example server/.env
```

Defaults in `server/.env` are enough for the demo:

```env
PORT=4000
JWT_SECRET=change-me-to-a-long-random-string
AI_MODE=mock
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5-5
TIMEZONE=Asia/Kolkata
```

To use real Claude later: set `AI_MODE=claude` and put your key in `ANTHROPIC_API_KEY`. The key **never** goes to the browser.

### 4. Seed demo data + start

```bash
npm run seed
npm run dev
```

- App: **http://localhost:5173**
- API: http://localhost:4000  
  (Vite proxies `/api` and `/socket.io` automatically)

### 5. Log in

| Field | Value |
|---|---|
| Email | `demo@decisionflow.app` |
| Password | `demo1234` |
| Project | **Campus Connect App** |

---

## Feature checklist (after login)

Do these in order. Full narration: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

| Step | Where | What you should see |
|---|---|---|
| 1 | **Dashboard** | Stats for open / overdue actions, decisions this week; Meeting 1 listed |
| 2 | Top-bar search `launch` | Decision “Launch the beta on 15 March” + transcript hits |
| 3 | **Decisions** → open that row | APPROVED, source quote, status history |
| 4 | **Meetings → Sprint 2 Planning → Start** | Status LIVE |
| 5 | Input = **Demo script** → `meeting2_followup.txt` → **Play** (try 2× or 4×) | Transcript + extracted cards; chit-chat not extracted |
| 6 | **Alerts** column | Flag: 1 April vs 15 March → **Accept** → old decision MODIFIED/SUPERSEDED |
| 7 | Same column | Recurring SMTP blocker (“also raised in Sprint 1 Kickoff”) |
| 8 | **End meeting → View report** | Markdown summary; Print / Save as PDF; Download .md |
| 9 | **Decisions** → open either launch decision | **Decision chain** links the two versions |
| 10 | **Action Items** | Overdue rows in red; change status with the dropdown |
| 11 | **Insights** | Bar / pie / line charts, accountability %, recurring blockers |
| 12 | **Review Queue** | Any leftover PENDING flags (sidebar shows a red count) |

Optional: second browser window on the same Live Meeting URL to show live join.  
Optional: Input = **Microphone** (Chrome/Edge, allow permission) and read lines from `demo/meeting2_followup.txt`.

---

## Useful commands

```bash
npm run install:all   # install root + server + client deps
npm run seed          # reset SQLite demo DB (SPEC §11 data)
npm run dev           # server + client together
npm test              # server unit tests (similarity, lifecycle, mock extract)
npm run seed --prefix server   # same as npm run seed
```

Database file (created automatically): `server/data/decisionflow.db`  
Reset anytime with `npm run seed`.

---

## Project layout

```
decisionflow/
├── client/          React + Vite UI
├── server/          Express + Socket.IO + SQLite + AI
│   ├── .env.example
│   ├── schema.sql
│   ├── seed.js
│   ├── routes/
│   ├── services/
│   └── test/
├── demo/            meeting1_kickoff.txt, meeting2_followup.txt, meeting3_review.txt
├── docs/            SPEC + guides (see below)
└── README.md        ← you are here
```

Not part of this app: `_old_java_version/`, legacy `backend/`, `frontend/` (if present).

---

## Docs

| Doc | Use it for |
|---|---|
| [docs/GUIDE.md](docs/GUIDE.md) | Prepare machine, **Step 9** demo checklist, **team division**, troubleshooting |
| [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) | Spoken viva demo script |
| [docs/SPEC.md](docs/SPEC.md) | Full product specification |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component + sequence diagrams |
| [docs/DATABASE.md](docs/DATABASE.md) | ER diagram + tables |
| [docs/API.md](docs/API.md) | REST + Socket.IO reference |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `better-sqlite3` fails to install | Use Node **20 LTS**; delete `node_modules` and run `npm run install:all` again |
| Page loads but API errors | Confirm `npm run dev` shows both `server` and `client`; open **localhost:5173** not :4000 for the UI |
| Mic silent | Chrome/Edge + `http://localhost:5173` + mic permission; or use **Demo script** instead |
| No extraction / no alerts | Stay on mock mode; wait for ~4 demo lines (or 20s); ensure you ran `npm run seed` so Meeting 1 decisions exist |
| Weird old data | `npm run seed` then refresh the browser (re-login if the demo user id changed) |

More detail: [docs/GUIDE.md](docs/GUIDE.md) §5.

---

## Security

- Keep secrets in `server/.env` only (gitignored).  
- Passwords are bcrypt-hashed; APIs use JWT.  
- SQL uses prepared statements only.
