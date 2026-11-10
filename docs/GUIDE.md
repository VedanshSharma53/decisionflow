# DecisionFlow — Project Guide

Practical info for the team: what the system is, what to prepare, how to split work, and how to run a clean demo.  
Product rules live in [SPEC.md](SPEC.md). Clone / run steps live in the root [README.md](../README.md).

---

## 1. What we built (viva one-liner)

Chrome mic (or typed / uploaded / demo transcript) → live transcript → every few lines the AI extracts decisions and tasks → saved in SQLite → each new decision is compared with older ones → a human accepts or rejects the flag → every open screen updates live.

| Module | Where it lives |
|---|---|
| UI + meeting management | `client/src/pages/*`, `server/routes/meetings.js` |
| Live speech-to-text | `client/src/speech.js` + upload + `demo/` scripts |
| AI meeting analysis | `server/services/extraction.js`, `ai.js` |
| Real-time dashboard | Socket.IO + Live Meeting page |
| Decision repository | `decisions` + FTS5 search |
| Decision lifecycle | `server/services/lifecycle.js` + `decision_history` |
| Conflict / change detection | `server/services/conflicts.js` |
| Human review | Review cards + `POST /api/relations/:id/review` |
| Accountability | Action items, overdue, recurring blockers, Insights |
| Meeting reports | `server/services/reports.js` + Meeting Report page |

**Three ideas to explain**
1. **Small batches** — every ~4 lines (or 20s) only *new* lines go to the AI, with a little context. Fast, cheap, fewer duplicates.
2. **Two-step conflict check** — keyword scoring finds candidates; AI (or mock) classifies DUPLICATE / MODIFIES / SUPERSEDES / CONFLICTS. AI only **flags**; a person **confirms**.
3. **Nothing is lost** — every status change is in history; replaced decisions stay linked in the decision chain.

---

## 2. What to prepare (before coding or demo day)

### Tools
1. **Node.js 20 LTS** — `node -v` should print v20+. Avoid bleeding-edge “Current” if `better-sqlite3` fails to install.
2. **Chrome or Edge** — required for microphone demos (Web Speech API).
3. **Git** + a shared repo so the team can pull the same code.
4. Optional: Anthropic API key only if you want real Claude (`AI_MODE=claude`). **Mock mode needs no key.**

### First-time machine setup
```bash
git clone <your-repo-url>
cd decisionflow
npm run install:all
copy server\.env.example server\.env   # Windows
# or: cp server/.env.example server/.env
```

Edit `server/.env` if you like (defaults are fine for mock):

```env
PORT=4000
JWT_SECRET=change-me-to-a-long-random-string
AI_MODE=mock
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5-5
TIMEZONE=Asia/Kolkata
```

Then:

```bash
npm run seed
npm run dev
```

Open **http://localhost:5173** → log in as `demo@decisionflow.app` / `demo1234`.

### Folder map
```
client/     React UI
server/     API, Socket.IO, SQLite, AI
demo/       Scripted meeting transcripts
docs/       SPEC, architecture, API, this guide, demo guide
```

Ignore `_old_java_version/` (and any leftover `backend/` / `frontend/`) — not part of this app.

---

## 3. Step 9 — Demo & submission prep

Treat this as the last checklist after the app already runs.

### 9.1 Reset and smoke-test
- [ ] `npm run seed` (clean demo DB)
- [ ] `npm run dev` (server :4000, Vite :5173)
- [ ] `npm test` (similarity, lifecycle, mock extractor)
- [ ] Log in with the demo account; Dashboard shows Meeting 1 stats

### 9.2 Feature walk (must all work)
Follow [DEMO_GUIDE.md](DEMO_GUIDE.md) end-to-end. Tick each:

| # | Feature | How to check |
|---|---|---|
| 1 | Login / project | Demo login; project dropdown = Campus Connect App |
| 2 | Dashboard | Open / overdue / decisions this week show numbers |
| 3 | Decisions + search | Search `launch` → 15 March APPROVED; top-bar search also works |
| 4 | Live transcript | Sprint 2 → Start → Demo `meeting2_followup.txt` |
| 5 | AI extraction | Cards for decisions / actions / blockers / questions; chit-chat ignored |
| 6 | Conflict review | Alert on 1 April vs 15 March → Accept → old status updates |
| 7 | Recurring blocker | SMTP alert mentions Sprint 1 Kickoff |
| 8 | Meeting report | End meeting → View report → Print / Download .md |
| 9 | Decision chain | Open related decision → chain links versions |
| 10 | Action items | Overdue rows red; status dropdown saves |
| 11 | Insights | Charts + accountability score + recurring table |
| 12 | Review Queue | Sidebar red count when flags pending |

### 9.3 Submission bundle
- [ ] README + docs are enough for a stranger to clone and run (no Cursor prompts needed)
- [ ] `server/.env` is **not** committed (only `.env.example`)
- [ ] Architecture / DB / API docs match what you show in the report and PPT
- [ ] Practise the demo once with mic **and** once with Demo script (fallback)

---

## 4. Dividing work (4 people)

Agree **early** on the contracts in SPEC §6 (Socket.IO events) and §9 (REST API). Those are the interfaces between frontend and backend.

| Person | Owns | Main folders |
|---|---|---|
| **A** | Server core: auth, projects, meetings API, Socket.IO rooms, segments | `server/index.js`, `routes/auth.js`, `routes/meetings.js`, `services/realtime.js`, `services/segments.js` |
| **B** | All React pages, layout, styling, live UI wiring | `client/src/pages/*`, `components/*`, `App.jsx`, `index.css` |
| **C** | Speech, AI extraction, prompts, conflict detection, review flow | `speech.js`, `services/ai.js`, `extraction.js`, `conflicts.js`, `similarity.js`, `prompts/*`, ReviewCard |
| **D** | Schema, seed, demo scripts, reports, insights, docs, PPT / final report | `schema.sql`, `seed.js`, `demo/*`, `reports.js`, `insights`, `docs/*` |

**Integration order (historical build order)**  
1–2 Auth + meetings + live transcript → 3 Mic → 4 Extraction → 5 Decisions/actions/seed → 6 Conflicts/review → 7 Blockers/insights/reports → 8 Search/docs/tests → **9 Demo prep (this section)**.

---

## 5. Common problems

| Problem | Fix |
|---|---|
| `better-sqlite3` install fails | Use Node **LTS**; delete `node_modules` and reinstall |
| Mic does nothing | Chrome/Edge; open `http://localhost:5173` (not a LAN IP); allow permission; Chrome speech needs internet |
| Speech stops after silence | Normal; app should restart while meeting is LIVE and not paused |
| Socket / blank live page | Server on :4000; Vite proxies `/api` and `/socket.io` with `ws: true`; JWT in socket `auth` |
| AI errors | Check `ANTHROPIC_API_KEY` or switch to `AI_MODE=mock`; inspect `ai_runs` table |
| Too many false conflict flags | Raise compare confidence (e.g. 0.7) or similarity threshold (e.g. 0.3) |
| Messy DB after testing | `npm run seed` resets to the SPEC §11 demo |

---

## 6. Related docs

- [SPEC.md](SPEC.md) — what the product must do  
- [ARCHITECTURE.md](ARCHITECTURE.md) — diagrams  
- [DATABASE.md](DATABASE.md) — schema  
- [API.md](API.md) — endpoints  
- [DEMO_GUIDE.md](DEMO_GUIDE.md) — spoken demo script  
- [../README.md](../README.md) — clone → install → run  
