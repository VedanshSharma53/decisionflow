# DecisionFlow — Build Guide + Cursor Prompts (Simple Stack)

How to use this:
- `SPEC.md` describes **what** to build.
- This file tells you **how** to get Cursor to build it, step by step, with copy-paste prompts.

**Stack:**
- React + Vite (JavaScript) for the frontend.
- Node.js + Express + Socket.IO for the backend.
- SQLite for the database. It's just a file, so there's no Docker and no database install.
- Chrome's built-in speech recognition for speech-to-text (free).
- Claude for the AI, plus a mock mode that needs no key.

You run everything with **one command**: `npm run dev`.

---

## Part A: Understand the system (for the viva and report)

**In one line:** Chrome mic → live transcript → every few lines the AI pulls out decisions and tasks → saved in SQLite → each new decision is compared with older ones → you approve or reject the flag → every screen updates live.

| Module from the abstract | Where it is built | Step |
|---|---|---|
| 1. UI and meeting management | Meetings pages + `routes/meetings.js` | 1–2 |
| 2. Live speech-to-text | `client/src/speech.js` (Web Speech API) + upload + demo script | 2–3 |
| 3. AI meeting analysis | `services/extraction.js` + `services/ai.js` | 4 |
| 4. Real-time dashboard | Socket.IO rooms + Live Meeting page | 2, 4 |
| 5. Decision repository | `decisions` table + SQLite full-text search | 5 |
| 6. Decision lifecycle | `services/lifecycle.js` + `decision_history` | 5 |
| 7. Conflict and change detection | `services/conflicts.js` (keyword match → AI compare) | 6 |
| 8. Human review | Review cards + `POST /relations/:id/review` | 6 |
| 9. Accountability tracking | Action items, overdue, recurring blockers, insights | 5, 7 |
| 10. Meeting reports | `services/reports.js` + print-to-PDF page | 7 |

**Three ideas to explain in the viva:**
1. **Small batches, not the whole transcript.** Every 4 lines (or 20 seconds) only the new lines go to the AI, along with a little context and what it has already found. That keeps it fast and cheap and avoids duplicates.
2. **Two-step conflict check.** First, simple word-overlap scoring finds older decisions on the same topic. Only those go to the AI, which says whether the new one is a duplicate, modifies the old one, replaces it, or conflicts with it. The AI only **flags**; a person **confirms**. That matches the patent claims.
3. **Nothing is lost.** Every status change is recorded in a history table. Replaced decisions stay visible with a link to the newer one, so you can show the "decision chain".

**About the patent and slides:** the patent says the technologies are "implementation options… not necessarily limiting". Switching to Node.js and SQLite is fine. Just update the two boxes in your architecture diagram:
- "Spring Boot Backend" → "Node.js + Express backend"
- "PostgreSQL" → "SQLite"

---

## Part B: What to install (Windows)

1. **Node.js LTS** (version 20 or newer) from nodejs.org. Check in a terminal: `node -v`
2. **Google Chrome** or Edge. Speech recognition works only in these.
3. **Git**, plus a GitHub repo for the team, so everyone can share code.
4. **Cursor**.

That's all. No Docker, no Java, no database server.

**AI key (optional at first):**
- Build and test everything with `AI_MODE=mock`, which is free and needs no key.
- For the real AI, create a key at console.anthropic.com, add a little credit, and put it in `server/.env`.
- The model is set in `.env` as `ANTHROPIC_MODEL`. The default is `claude-opus-5-5`. If you want lower cost, you can set `claude-haiku-5-5` instead; test that the extraction quality is still good enough for your demo.

---

## Part C: How to use Cursor well

1. Make a folder `decisionflow/` and open it in Cursor.
2. Create `docs/` and put `SPEC.md` inside it, as `docs/SPEC.md`.
3. Create the file `.cursor/rules/decisionflow.mdc` with this text. Cursor reads it in every chat.

```
---
description: DecisionFlow project rules
alwaysApply: true
---
- This repo builds the app described in docs/SPEC.md. Read the relevant SPEC sections before coding.
  Do not remove or simplify features from SPEC. If something in SPEC must change, update SPEC too and tell me why.
- Keep it simple: plain JavaScript (ES modules), React function components with useState/useEffect,
  Express + Socket.IO + better-sqlite3. No TypeScript, no Docker, no ORM, no Redux, no extra frameworks.
- All SQL lives in server/schema.sql and the route/service files. Use prepared statements (db.prepare) — never
  build SQL by joining user input into strings.
- The Anthropic API key stays in server/.env only. Never send it to the client. Never commit .env.
- All decision status changes go only through server/services/lifecycle.js. The AI never changes status directly.
- Use the official @anthropic-ai/sdk exactly as shown in SPEC §8.1 (output_config.format with zodOutputFormat).
  Do not use forced tool_choice — current Claude models reject it.
- After every task: start the app (npm run dev), fix every error in the terminal and browser console,
  then tell me exactly what to click to test it.
- Write clear, commented code that students can explain in a viva.
```

4. Use **Agent mode** with the best model Cursor offers you.
5. **Use a new chat for each step below.** Start each one with: *"Read docs/SPEC.md and the existing code first."*
6. After each step, test the **"Done when"** list yourself, then commit:

```bash
git add -A
```

```bash
git commit -m "step N done"
```

   If a later step breaks something, you can go back.
7. When there's an error, paste the **full** error text into Cursor and say: *"Find the real cause and fix it."*

---

## Part D: Step-by-step prompts (copy-paste one at a time)

### Step 0: Introduction (first chat only)

```
You are helping my student team build "DecisionFlow: Real-Time Meeting Decision Intelligence & Accountability",
our final-year major project. The full specification is in docs/SPEC.md — read all of it now.
We will build it in 8 steps; I'll give you one step at a time. Don't build later steps early.

Before writing code, reply with:
1) a short explanation of how the app works, in simple words,
2) anything in the SPEC that is unclear, with your suggested answer,
3) the folder tree you will create in Step 1.
Then wait for me.
```

### Step 1: Project setup, database, login

```
Step 1 (SPEC §2, §3, §5, §9 auth, §10 layout).

- Root package.json with a "dev" script using concurrently to run server and client together,
  and an "install:all" script that installs both.
- server/: Express app (ES modules), dotenv, cors, Socket.IO attached to the same HTTP server, nodemon for dev.
  db.js opens server/data/decisionflow.db with better-sqlite3 (create the data folder if missing), sets
  foreign_keys ON and WAL mode, runs schema.sql on start. schema.sql = the FULL schema from SPEC §5 including the
  FTS5 tables and their sync triggers. .env.example as in SPEC §3. data/ and .env in .gitignore.
- Auth: register/login with bcryptjs + jsonwebtoken; middleware/auth.js protects all other /api routes.
- Projects: GET/POST /api/projects.
- Error-handling middleware returning { error } with the right status code.
- client/: Vite + React (JavaScript) + Tailwind + React Router. api.js (fetch wrapper adding the token, base URL
  from Vite proxy to the server). Login and Register pages, protected routes, layout with sidebar + top bar
  (project dropdown, logout). Empty placeholder pages for all pages in SPEC §10. StatusBadge component with
  the colours from SPEC §10.
- README.md: how to install and run (npm run install:all, copy .env.example to .env, npm run dev).

Run it, fix all errors, then tell me how to test.
```
**Done when:** `npm run dev` opens the app, you can register, log in and create a project, and the file `server/data/decisionflow.db` appears.

### Step 2: Meetings and the live transcript (no AI yet)

```
Step 2 (SPEC §6, §7 other input modes, §9 meetings, §10 pages 3 and 4, §11 demo files).

- Meetings API: list, create (with participants), get one (with participants + transcript), start (SCHEDULED→LIVE),
  end (LIVE→ENDED). Only allowed status changes; otherwise 409.
- services/realtime.js and Socket.IO: JWT check in io.use(), rooms "meeting:<id>", events exactly as the table in
  SPEC §6 (meeting:join, segment:interim, segment:final, transcript:interim, transcript:final, meeting:status).
  Saving a final segment gives it the next seq number for that meeting.
- Input modes: Type (text box), Upload (.txt/.docx via multer + mammoth, lines "Name: text"),
  Demo script (services/demoPlayer.js plays a demo file one line every 2.5s / speed; play + stop endpoints).
- Rewrite the existing demo/meeting1_kickoff.txt, demo/meeting2_followup.txt, demo/meeting3_review.txt so they follow
  SPEC §11 exactly: 25–40 realistic lines each, with normal chit-chat that should NOT be extracted later.
  Meeting 1 must say SQLite (not PostgreSQL) and "email OTP only" for login. Keep the format "Name: sentence".
- Pages: Meetings list (tabs by status), New Meeting form (participants: type name + Enter), Live Meeting page with
  the 3-column layout from SPEC §10.4 — left transcript works fully (auto-scroll, interim grey italic, speaker bold);
  middle and right columns are placeholders for now. Header with input-mode dropdown and Start/End buttons.
- Opening the same meeting in a second browser tab must show the same live transcript (this is "join meeting").
```
**Done when:** you start a meeting, play `meeting2_followup.txt`, and the lines appear live in two browser tabs at once.

### Step 3: Microphone speech-to-text

```
Step 3 (SPEC §7).
- client/src/speech.js: Web Speech API wrapper exactly as SPEC §7 (continuous, interim results, language en-IN/en-US,
  auto-restart on end while recording, clean stop). Interim → segment:interim (throttled), final → segment:final.
- Live Meeting header: "Microphone" input mode with Start mic / Pause / Resume, a pulsing red dot while listening,
  a "Speaking as" participant dropdown, and a clear message if the browser is not Chrome/Edge or mic permission is denied.
- Only the host's browser records; other viewers just watch.
```
**Done when:** you talk into the mic in Chrome, your words appear live, and the other tab sees them too.

### Step 4: AI extraction (the most important step)

```
Step 4 (SPEC §8.1, §8.2, §8.6). Be careful and thorough here.
- server/services/ai.js exactly like SPEC §8.1 using @anthropic-ai/sdk + zod + zodOutputFormat
  (install the zod version that the SDK's helpers/zod supports — check the SDK README if unsure).
  Log each call in ai_runs. If AI_MODE=mock or no API key → use the mock functions (SPEC §8.6).
- prompts/extraction.md with the prompt from SPEC §8.2; zod schema from SPEC §8.2 (all fields required, nullable
  where optional).
- services/extraction.js: per-meeting buffer, run rule (4 lines or 20s, checked every 5s), one run at a time per
  meeting, build the prompt with meeting info + CONTEXT + NEW lines + EXISTING_ITEMS, save results (new items,
  updates with history rows, confidence filter, owner matching to participants, resolved questions), emit
  item:created / item:updated and ai:status. On meeting end: process the rest of the buffer.
  Upload mode: process the whole uploaded transcript in chunks of 15 lines.
- Middle column of Live Meeting: tabs Decisions / Actions / Blockers / Questions with counts; cards with badge,
  certainty, owner, deadline, quote, low-confidence tag; new cards flash; Approve / Reject / Edit on decisions.
  "AI processing…" indicator in the header with last latency. Errors show a small red toast but the meeting continues.
```
**Done when:** you play `meeting2_followup.txt`, and decisions, actions (Arjun · 25 Mar), the SMTP blocker and the dark-mode question appear live, while the chit-chat lines are ignored. Test once in mock mode and once with the real AI.

### Step 5: Decision history, statuses, action tracking

```
Step 5 (SPEC §4, §9 decisions/actions, §10 pages 6 and 7, §11 seed).
- services/lifecycle.js: allowed transitions from SPEC §4, every change writes decision_history, invalid → 409.
  Same idea for action items (action_history on status/owner/deadline change).
- Decisions API: search with decisions_fts MATCH + filters, detail (history, relations both ways, source lines),
  edit, approve, reject, approve-all-AGREED for a meeting.
- Actions API: list with filters (owner, status, overdue), update, history.
- server/seed.js (npm run seed): resets the DB and creates all demo data in SPEC §11, including Meeting 1 with its
  transcript and APPROVED decisions, action items and blocker (with history rows).
- Pages: Decisions (search + filters + table), Decision Detail (status timeline, quote, link to meeting),
  Action Items (table, inline status dropdown, overdue rows red, filters).
```
**Done when:** after `npm run seed`, searching "launch" finds the 15 March decision, Approve and Reject work, and every change shows in the history.

### Step 6: Conflict detection and review (the main feature)

```
Step 6 (SPEC §4 relation table, §8.3).
- services/similarity.js: stop-word removal + Jaccard overlap + the scoring formula in SPEC §8.3.
- services/conflicts.js: step 1 candidates (top 5, score ≥ 0.2), step 2 AI comparison (prompts/comparison.md,
  zod schema from SPEC), step 3 save PENDING relations with confidence ≥ 0.6 and emit relation:flagged.
  Called automatically for every new decision from extraction.js (don't block extraction — run it after saving).
- POST /api/relations/:id/review: apply the SPEC §4 table inside db.transaction(), using lifecycle.js only.
  GET /api/relations with filters.
- ReviewCard component: earlier decision (meeting + date + status) next to the new decision, type badge,
  AI explanation, changes list (e.g. date: 15 Mar → 1 Apr), confidence, buttons (Accept/Reject; for CONFLICTS:
  Keep new / Keep old / Keep both), optional note. Used in the Live Meeting right column and the Review Queue page.
  Sidebar shows the pending count. After accepting, the old decision's badge updates live.
- Decision Detail: "decision chain" showing earlier/later versions through relations.
```
**Done when:** you run Meeting 2 and "move the launch to 1 April" shows an alert against "15 March". You click Accept, 15 March becomes SUPERSEDED or MODIFIED, and the chain shows both. "Google sign-in" is flagged against "email OTP only".

### Step 7: Recurring blockers, insights, reports

```
Step 7 (SPEC §8.4, §8.5, §10 pages 2, 5, 9).
- Recurring blocker check (SPEC §8.4) + blocker:recurring event + alert card in the Live Meeting right column.
- Insights API + Insights page with Recharts: actions per owner (open/done/overdue), decision status pie,
  decisions per meeting line chart, recurring blockers table, accountability score.
- Dashboard page: 4 stat cards, my action items, recent meetings, recurring blockers.
- Reports: generate the summary at meeting end (SPEC §8.5, mock = template), regenerate button,
  Meeting Report page (react-markdown, transcript, items), "Print / Save as PDF" with print CSS, "Download .md".
  Decision Log and Action Item reports (template-based) reachable from the Decisions and Action Items pages.
```
**Done when:** the SMTP blocker shows as recurring, the charts show real numbers, and ending a meeting gives a clean report you can save as a PDF.

### Step 8: Polish and documents

```
Step 8 — make it demo-ready and submission-ready.
- Global search box in the top bar (decisions, action items, transcript lines) using /api/search.
- Loading states, empty states ("No decisions yet"), friendly error messages, works well on a 1366×768 laptop screen.
- Check every page for console errors and fix them.
- Write docs/ARCHITECTURE.md (Mermaid diagram of the components + a sequence diagram of the live flow and the
  conflict flow), docs/DATABASE.md (Mermaid ER diagram + table descriptions), docs/API.md (every endpoint with an
  example request/response), docs/DEMO_GUIDE.md (the demo steps from my guide), and update README.md.
- Add a few simple tests with node:test for similarity.js, lifecycle.js transitions, and the mock extractor.
- Review the code for unused files, hard-coded secrets, and SQL built from user input.
```

---

## Part E: Demo script (practise this)

1. Run `npm run seed`, then `npm run dev`, then log in as `demo@decisionflow.app`.
2. **Dashboard**: shows data from Meeting 1.
3. **Decisions**: search "launch" → "Launch the beta on 15 March", APPROVED.
4. Open **Sprint 2 Planning** → Start. Open the same meeting in a second window to show "join".
   - **Option A:** speak with the mic. You and a teammate read lines from `meeting2_followup.txt`.
   - **Option B:** Demo script mode. It's safe if the mic or Wi-Fi fails, so keep it ready.
5. Show the transcript flowing and cards appearing with owner and deadline, and point out that chit-chat is ignored.
6. The **red alert** appears: "1 April modifies/replaces 15 March". Click **Accept** and the old decision turns grey.
7. The **recurring blocker** alert appears: "SMTP access, also raised in Sprint 1 Kickoff".
8. **End the meeting** → open the report → Save as PDF.
9. Show the **decision chain**, the **Action Items** page (overdue in red) and the **Insights** charts.

---

## Part F: Splitting work across 4 people

| Person | Work |
|---|---|
| A | Server setup, login, meetings API, Socket.IO (Steps 1–2 backend) |
| B | All React pages and design (every step's frontend) |
| C | Speech, AI extraction, prompts, conflict detection (Steps 3, 4, 6). Tunes the prompts with the demo files. |
| D | Database schema, seed data, demo scripts, reports, insights, documentation, final report and PPT (Steps 5, 7, 8) |

Agree on SPEC §6 (Socket.IO events) and §9 (API) early. They're the contract between frontend and backend.

---

## Part G: Common problems

- **`better-sqlite3` fails to install:** use the Node **LTS** version, not the newest "Current" one. It has ready-made downloads for LTS. Delete `node_modules` and reinstall.
- **Mic does nothing:**
  - Use Chrome or Edge.
  - Open the app at `http://localhost:5173`, not an IP address. Browsers only allow the mic on localhost or https.
  - Allow mic permission.
  - Chrome's speech recognition needs internet.
- **Speech stops after a pause:** that's normal browser behaviour. Make sure the auto-restart in `onend` is working.
- **Socket doesn't connect:** check that the Vite proxy forwards `/socket.io` with `ws: true`, and that the token is sent in `auth`.
- **AI errors:**
  - Check `ANTHROPIC_API_KEY` in `server/.env` and restart the server.
  - Look in the `ai_runs` table for the error.
  - Switch to `AI_MODE=mock` to keep working.
- **Too many false conflict alerts:** raise the confidence threshold to 0.7, or the similarity threshold to 0.3.
- **Database got messy during testing:** run `npm run seed` to reset it.
