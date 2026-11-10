# DecisionFlow — Project Specification (Simple Stack)

> Put this file in the repo at `docs/SPEC.md`. Every Cursor prompt refers to it.
> Goal: a **simple, working prototype** that a student team can run on any Windows laptop with one command.
> No Docker, no database server to install, no paid speech service required.

## 1. What we are building

DecisionFlow listens to a meeting and, while the meeting is going on, turns the conversation into:
- **Decisions**: agreed outcomes, e.g. "Launch the beta on 1 April".
- **Action items**: tasks, with an owner and deadline when they were said.
- **Blockers**: things stopping progress.
- **Open questions**: questions raised but not answered.

Everything is saved in a searchable history that covers all meetings. When a new decision relates to an older one, the app compares the two. It flags the new one as a possible **conflict**, **modification**, **replacement (supersedes)** or **duplicate**. A human reviews the flag before any old record changes. Nothing is ever deleted; every status change is kept in a history table.

```
Browser mic (Web Speech API) / typed text / uploaded transcript / demo script
      │  (Socket.IO)
      ▼
Node.js server saves transcript lines ──► pushes them live to everyone in the meeting
      │
      ▼  every ~4 lines or 20 s
AI extraction (Claude) ──► decisions / action items / blockers / questions ──► saved in SQLite ──► pushed live
      │
      ▼  for each new decision
Find similar older decisions (simple keyword matching) ──► AI compares ──► flag for review
      │
      ▼
User accepts / rejects ──► decision status updated + history row
```

## 2. Tech stack (simple, JavaScript everywhere)

| Part | Choice | Why |
|---|---|---|
| Frontend | **React + Vite**, plain **JavaScript** (no TypeScript), **Tailwind CSS**, React Router, `socket.io-client`, Recharts (charts), `react-markdown` | Easy and fast to build |
| Backend | **Node.js 20+** with **Express**, **Socket.IO**, `dotenv`, `multer` (uploads), `mammoth` (.docx → text), `bcryptjs` + `jsonwebtoken` (simple login), `nodemon` | One language for the whole project |
| Database | **SQLite** via `better-sqlite3`. A single file, `server/data/decisionflow.db`, with **FTS5** full-text search built in. | Nothing to install; the DB is just a file |
| Speech-to-text | **Browser Web Speech API** (free, built into Chrome/Edge). Also: typed input, transcript upload (.txt/.docx), and a demo script player. | No API key or cost |
| AI | **Claude** via the official SDK `@anthropic-ai/sdk`, with `zod` for the output schema. Model from `.env`, default `claude-opus-5-5`. **Mock mode** (regex rules) runs with no key. | Matches the patent ("OpenAI or Claude") |
| PDF reports | Browser **Print → Save as PDF** on a print-friendly report page | No PDF library needed |
| Run | Root `package.json` with `concurrently`: `npm run dev` starts both server and client | One command |

The API key lives only in `server/.env`. It is never sent to the browser.

## 3. Folder structure

```
decisionflow/
├── package.json                 root: "dev" script runs server + client together (concurrently)
├── server/
│   ├── package.json
│   ├── .env.example             PORT, JWT_SECRET, AI_MODE=claude|mock, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, TIMEZONE=Asia/Kolkata
│   ├── index.js                 Express app + Socket.IO setup
│   ├── db.js                    opens SQLite, runs schema.sql, exports db
│   ├── schema.sql               all tables (section 5)
│   ├── seed.js                  demo data (section 9), run with `npm run seed`
│   ├── middleware/auth.js       JWT check
│   ├── routes/                  auth.js, projects.js, meetings.js, decisions.js, actions.js, relations.js,
│   │                            blockers.js, questions.js, insights.js, reports.js, search.js
│   ├── services/
│   │   ├── ai.js                callClaude(schema, system, user, effort) + mock mode
│   │   ├── extraction.js        buffering per meeting + extract + save results
│   │   ├── conflicts.js         find similar decisions + AI compare + create relations
│   │   ├── lifecycle.js         ALL decision status changes go through here
│   │   ├── similarity.js        keyword/word-overlap scoring (used by conflicts + blockers)
│   │   ├── reports.js           meeting summary report (Markdown)
│   │   ├── demoPlayer.js        plays demo/*.txt line by line
│   │   └── realtime.js          io instance + helpers emitToMeeting(meetingId, event, data)
│   └── prompts/                 extraction.md, comparison.md, summary.md
├── client/
│   ├── package.json
│   └── src/
│       ├── main.jsx, App.jsx    routes + layout (sidebar)
│       ├── api.js               fetch wrapper that adds the JWT
│       ├── socket.js            socket.io-client connection
│       ├── speech.js            Web Speech API helper
│       ├── components/          StatusBadge, ItemCard, ReviewCard, TranscriptPanel, StatCard, Modal, …
│       └── pages/               Login, Dashboard, Meetings, NewMeeting, LiveMeeting, MeetingReport,
│                                Decisions, DecisionDetail, ActionItems, ReviewQueue, Insights
├── demo/                        meeting1_kickoff.txt, meeting2_followup.txt, meeting3_review.txt
└── docs/                        SPEC.md, ARCHITECTURE.md, DATABASE.md, API.md, DEMO_GUIDE.md
```

## 4. Statuses (decision lifecycle)

### Decision status
```
PROPOSED ──approve──► APPROVED ──(later decision modifies it)──► MODIFIED
    │                     └──────(later decision replaces it)──► SUPERSEDED
    └──reject──► REJECTED
```
- Every decision the AI extracts starts as **PROPOSED**. The AI also gives a `certainty` (AGREED or TENTATIVE), shown as a small badge.
- The user clicks Approve → APPROVED, or Reject → REJECTED. There is also an "Approve all AGREED" button for each meeting.
- `services/lifecycle.js` holds the allowed transitions. Any other change is refused with HTTP 409.
- **Every** status change adds a row to `decision_history`. Nothing is deleted.

### Action item status
`OPEN`, `IN_PROGRESS`, `DONE`, `BLOCKED`. An item is **overdue** when its deadline is before today and its status is not DONE. Every change to status, owner or deadline adds a row to `action_history`.

### Relation types (conflict and change detection)
| Type | Meaning | When the user clicks **Accept** |
|---|---|---|
| `DUPLICATE` | Same decision said again | New decision → REJECTED (reason "duplicate of #id") |
| `MODIFIES` | Same topic, a detail changed (date, number, scope, owner) | Old → MODIFIED; new → APPROVED |
| `SUPERSEDES` | New decision fully replaces the old one | Old → SUPERSEDED (`superseded_by_id` = new); new → APPROVED |
| `CONFLICTS` | They contradict and it's unclear which wins | User picks: **Keep new** (acts like SUPERSEDES), **Keep old** (new → REJECTED), or **Keep both** (no status change) |

If the user clicks **Reject** on the flag, only the relation is marked REJECTED and the decisions stay as they are. The AI never changes a status by itself.

## 5. Database (SQLite, `server/schema.sql`)

Use `INTEGER PRIMARY KEY AUTOINCREMENT` ids and ISO date strings. Store arrays (keywords, segment ids) as JSON text. Turn on `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`. Use `CREATE TABLE IF NOT EXISTS`, so the schema runs on every start.

```sql
users(id, name, email UNIQUE, password_hash, created_at)
projects(id, name, description, created_at)

meetings(id, project_id, title, agenda, scheduled_at, started_at, ended_at,
         status CHECK IN ('SCHEDULED','LIVE','ENDED'), host_user_id, created_at)
participants(id, meeting_id, name)

segments(id, meeting_id, seq, speaker, text, source CHECK IN ('MIC','MANUAL','UPLOAD','DEMO'), created_at)

decisions(id, project_id, meeting_id, title, description, topic, keywords /*JSON*/,
          certainty CHECK IN ('AGREED','TENTATIVE'),
          status CHECK IN ('PROPOSED','APPROVED','MODIFIED','SUPERSEDED','REJECTED') DEFAULT 'PROPOSED',
          confidence REAL, owner, source_quote, source_segment_ids /*JSON*/, superseded_by_id,
          approved_by, approved_at, created_at, updated_at)
decision_history(id, decision_id, from_status, to_status, reason, relation_id, changed_by /*null = system*/, changed_at)

relations(id, new_decision_id, old_decision_id,
          type CHECK IN ('DUPLICATE','MODIFIES','SUPERSEDES','CONFLICTS'),
          explanation, confidence REAL, changed_fields /*JSON e.g. {"date":{"from":"15 Mar","to":"1 Apr"}}*/,
          review_status CHECK IN ('PENDING','ACCEPTED','REJECTED') DEFAULT 'PENDING',
          resolution /*KEEP_NEW|KEEP_OLD|KEEP_BOTH|null*/, reviewed_by, reviewed_at, note, created_at,
          UNIQUE(new_decision_id, old_decision_id))

action_items(id, project_id, meeting_id, title, description, owner, deadline /*YYYY-MM-DD*/, deadline_text,
             status CHECK IN ('OPEN','IN_PROGRESS','DONE','BLOCKED') DEFAULT 'OPEN',
             priority DEFAULT 'MEDIUM', confidence REAL, source_quote, source_segment_ids, completed_at, created_at, updated_at)
action_history(id, action_id, field, old_value, new_value, changed_by, changed_at)

blockers(id, project_id, meeting_id, description, owner, keywords, group_id /*id of first similar blocker*/,
         resolved INTEGER DEFAULT 0, source_quote, created_at)
questions(id, project_id, meeting_id, question, raised_by, resolved INTEGER DEFAULT 0, resolved_in_meeting_id,
          source_quote, created_at)

reports(meeting_id PRIMARY KEY, summary_md, created_at)
ai_runs(id, meeting_id, kind /*EXTRACT|COMPARE|SUMMARY*/, latency_ms, status /*OK|FAILED*/, error, created_at)

-- Full-text search
CREATE VIRTUAL TABLE decisions_fts USING fts5(title, description, topic, content='decisions', content_rowid='id');
CREATE VIRTUAL TABLE segments_fts  USING fts5(text, content='segments', content_rowid='id');
-- plus INSERT/UPDATE/DELETE triggers that keep the fts tables in sync
```

Also create `docs/DATABASE.md` with a Mermaid ER diagram of these tables.

## 6. Real-time (Socket.IO)

Every meeting is a Socket.IO **room** named `meeting:<id>`. The client sends its JWT in `io(url, { auth: { token } })`, and the server checks it in `io.use()`.

| Direction | Event | Data |
|---|---|---|
| client → server | `meeting:join` | `{ meetingId }`. Joins the room and receives the transcript so far. |
| client → server | `segment:interim` | `{ meetingId, text }`. Live partial text (not saved). Throttle to about 4 per second. |
| client → server | `segment:final` | `{ meetingId, text, speaker? }`. Saved as a segment. |
| server → room | `transcript:interim` | `{ text, speaker }` |
| server → room | `transcript:final` | `{ segment }` |
| server → room | `item:created` / `item:updated` | `{ itemType: 'decision'\|'action'\|'blocker'\|'question', item }` |
| server → room | `relation:flagged` | `{ relation, newDecision, oldDecision }` |
| server → room | `blocker:recurring` | `{ blocker, previousMeetings: [{id, title, date}] }` |
| server → room | `meeting:status` | `{ status: 'LIVE'\|'ENDED' }` |
| server → room | `ai:status` | `{ state: 'processing'\|'idle'\|'error', message?, latencyMs? }` |

**Join a meeting:** anyone who opens the same Live Meeting page joins the room and sees everything live. Only the host's browser runs the microphone.

## 7. Speech-to-text (browser)

`client/src/speech.js` wraps `window.SpeechRecognition || window.webkitSpeechRecognition`:
- `continuous = true`, `interimResults = true`, `lang = 'en-IN'` (selectable: en-IN / en-US).
- Interim results → `segment:interim`. Final results → `segment:final`.
- The browser stops recognition by itself after silence. Restart it automatically in `onend` while the meeting is LIVE and not paused.
- Show a clear message if the browser doesn't support it ("Please use Chrome or Edge").
- Speaker: a small "Speaking as: [participant dropdown]" selector next to the mic button, so lines get a speaker name. Default "Speaker".

**Other input modes** (dropdown in the Live Meeting header):
- **Microphone**: as above.
- **Type**: a text box; Enter sends `segment:final`.
- **Upload transcript**: .txt or .docx file. Each `Name: text` line becomes a segment, then extraction runs.
- **Demo script**: pick a file from `demo/`. The server plays one line every 2.5 s, as if spoken live. **This is the safe mode for the project demo.**

## 8. AI processing

### 8.1 `services/ai.js`: one function used everywhere

```js
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// Returns validated JSON matching the zod schema, or throws.
export async function askClaude({ system, user, schema, effort = "low" }) {
  const response = await client.beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                 // if the model declines, the API retries on a fallback model automatically
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: zodOutputFormat(schema) },   // forces JSON matching the schema
  });
  if (response.stop_reason === "refusal") throw new Error("AI declined this request");
  const text = response.content.find((b) => b.type === "text")?.text;
  return schema.parse(JSON.parse(text));  // validate again with zod before using it
}
```

- Use `effort: "low"` for live extraction (fast), and `"medium"` for comparison and the summary report.
- **Do NOT use forced tool calls** (`tool_choice: {type: "tool"}`). Current Claude models reject them. Use `output_config.format` as shown above.
- If `AI_MODE=mock` or there's no API key, `askClaude` is never called. The mock functions in 8.6 are used instead.
- Log every call in `ai_runs` (kind, latency, status). If a call fails, catch the error, emit `ai:status` with `error`, and keep the meeting running.

### 8.2 Live extraction (`services/extraction.js`)
- Keep an in-memory buffer per LIVE meeting: `Map<meetingId, { newSegments: [], lastRunAt, running }>`.
- Run extraction when there are **4 or more new final segments**, or when **20 seconds** have passed and there's at least 1 new segment. Check with a `setInterval` every 5 s. Only **one run at a time per meeting**: if one is running, wait for the next tick.
- Send the AI:
  1. Meeting info: title, agenda, today's date, timezone, participant names.
  2. **CONTEXT**: the last 8 already-processed lines, for understanding only.
  3. **NEW** lines with their segment ids.
  4. **EXISTING_ITEMS**: what's already been found in this meeting (id, type, title), so it doesn't repeat them.
- Save the result:
  - Insert new items, or apply `updates` to existing ones (with history rows).
  - Drop items with `confidence < 0.5`. Items under 0.7 get a "low confidence" badge.
  - Match the owner to a participant name (case-insensitive, first-name match). Otherwise keep the raw name.
  - Emit `item:created` / `item:updated`.
  - Send each new decision to `conflicts.check(decision)`, and each new blocker to the recurring-blocker check.
  - Mark the questions in `resolvedQuestionIds` as resolved.
- **When the meeting ends**: process anything still in the buffer, then generate the summary report (8.5).

**Extraction prompt (`prompts/extraction.md`):**
```
You are DecisionFlow's meeting analyst. Read the NEW transcript lines of a live meeting and extract ONLY
concrete meeting outcomes. Be conservative: missing an item is better than inventing one.

- DECISION: something the group agreed on or someone settled ("let's go with", "we've decided", "final", "okay, X it is").
  certainty = AGREED if clearly settled, TENTATIVE if leaning but not final. Suggestions and questions are NOT decisions.
- ACTION ITEM: a specific task someone committed to or was given ("Ravi will…", "I'll take that").
- BLOCKER: something currently stopping progress (waiting on access, a bug, an approval).
- OPEN QUESTION: a question asked and not answered in these lines.

Rules:
1. owner: only if a person is clearly named or says "I'll do it" (then the speaker's name). Never guess; else null.
2. deadline: only if a time was said. Convert "Friday", "next week", "end of month" to YYYY-MM-DD using the meeting
   date given. Also return the exact words in deadlineText. If no time was said, both null.
3. Each item needs sourceSegmentIds (from NEW lines only) and a short exact sourceQuote (max 200 characters).
4. Do not extract from CONTEXT lines; they only help you understand references like "that" or "it".
5. If a NEW line adds detail to something in EXISTING_ITEMS, put it in "updates" with its existingId. Don't create a duplicate.
6. title: max 12 words, understandable on its own.
7. topic: 1–4 words (e.g. "launch date", "login method"). keywords: 3–6 lowercase words.
   These are used to match decisions across meetings, so keep them specific and consistent.
8. confidence: 0 to 1.
9. resolvedQuestionIds: ids from EXISTING_ITEMS questions that the NEW lines answer.
10. If nothing qualifies, return empty lists.
```

**Extraction schema** (write it in zod; make every field required and use `.nullable()` for optional values):
```
{ decisions:   [{ title, description, topic, keywords[], certainty: AGREED|TENTATIVE, owner|null, confidence, sourceSegmentIds[], sourceQuote }],
  actionItems: [{ title, description, owner|null, deadline|null, deadlineText|null, priority: LOW|MEDIUM|HIGH, confidence, sourceSegmentIds[], sourceQuote }],
  blockers:    [{ description, owner|null, keywords[], confidence, sourceSegmentIds[], sourceQuote }],
  questions:   [{ question, raisedBy|null, confidence, sourceSegmentIds[], sourceQuote }],
  updates:     [{ existingId, itemType: decision|action, owner|null, deadline|null, deadlineText|null, description|null }],
  resolvedQuestionIds: [] }
```

### 8.3 Conflict and change detection (`services/conflicts.js`)

**Step 1: find similar older decisions.** This is plain JavaScript in `services/similarity.js`, with no AI and no special database features.
- Take all decisions in the same project with status PROPOSED, APPROVED or MODIFIED, excluding the new one. This also includes earlier decisions from the same meeting.
- Score each: `0.5 × keywordOverlap + 0.3 × titleWordOverlap + 0.2 × (same topic ? 1 : 0)`.
  - Overlap = Jaccard similarity, i.e. shared words ÷ all words.
  - Lowercase everything and remove common stop-words first.
- Keep the **top 5 with score ≥ 0.2**. If there are none, stop: it's a new decision with nothing to compare.

**Step 2: AI comparison** (`prompts/comparison.md`, effort `medium`):
```
Compare a NEW meeting decision with EARLIER decisions from the same project.
For each earlier decision answer one of:
- UNRELATED: different subject.
- DUPLICATE: the same decision said again, nothing important changed.
- MODIFIES: same subject and intent, but a detail changed (date, number, scope, owner, technology).
- SUPERSEDES: the new decision fully replaces the earlier one.
- CONFLICTS: they contradict each other and it is not clear the new one is meant to replace the old.
Give a 1–2 sentence explanation that mentions both decisions, changedFields like {"date":{"from":"15 March","to":"1 April"}}
when something changed, and confidence 0–1. Two decisions on the same topic that can both be true are NOT conflicts.
```
Schema: `{ results: [{ candidateId, relation, confidence, explanation, changedFields: [{ field, from, to }] }] }`. (A list is used instead of an object with free-form keys, because structured outputs need fixed fields.)

**Step 3:** for each result where the relation isn't UNRELATED and `confidence ≥ 0.6`:
- insert a `relations` row with status PENDING;
- emit `relation:flagged` to the meeting room.

**Step 4: human review.** `POST /api/relations/:id/review` with `{ action: 'ACCEPT'|'REJECT', resolution?, note? }`. It applies the table in section 4 through `lifecycle.js`, inside one SQLite transaction (`db.transaction(...)`).

### 8.4 Recurring blockers
When a blocker is saved, compare it with blockers from **other meetings** in the same project, using the similarity function on keywords + description (threshold 0.3).
- If one matches, set `group_id` to that blocker's `group_id` (or its `id`).
- Emit `blocker:recurring`, e.g. "Also raised in 'Sprint 1 Kickoff'".
- A group seen in 2 or more meetings counts as a **recurring blocker** on the Insights page.

### 8.5 Meeting report (`services/reports.js`)
At meeting end, ask the AI (`prompts/summary.md`, effort `medium`) for Markdown with these sections:
- Overview (3–5 sentences)
- Key Decisions (with status)
- Action Items table (owner, deadline, status)
- Blockers
- Open Questions
- Changes to Earlier Decisions (from relations)
- Follow-ups for the Next Meeting

Give it the saved items, **not** the raw transcript, so it's short and accurate. Save the result in `reports`.

In mock mode, build the same Markdown from the database with a template string.

There are also two template-only reports, with no AI:
- **Decision Log**: all project decisions with status and history.
- **Action Item Report**: grouped by owner, overdue first.

### 8.6 Mock mode (no API key needed)
- Extraction uses regex:
  - `/(we('ve)? decided|let's go with|final|agreed)/i` → decision
  - `/\b([A-Z][a-z]+) will (.+?)(?: by (.+?))?[.!]?$/` → action item (owner, deadline text)
  - `/(blocked|waiting on|waiting for|stuck)/i` → blocker
  - a line ending in `?` → question
- Comparison: same topic word and a different date or number → MODIFIES (confidence 0.7).

The whole app must be usable in mock mode.

## 9. API (Express, all under `/api`, JWT needed except login/register)

```
POST /auth/register, /auth/login              → { token, user }
GET  /projects        POST /projects
GET  /meetings?projectId=&status=      POST /meetings {projectId, title, agenda, scheduledAt, participants[]}
GET  /meetings/:id    (meeting + participants + transcript + items)
POST /meetings/:id/start     POST /meetings/:id/end
POST /meetings/:id/upload    (multipart file .txt/.docx)
POST /meetings/:id/demo/play {file, speed}     POST /meetings/:id/demo/stop
GET  /meetings/:id/report    POST /meetings/:id/report/regenerate
GET  /decisions?projectId=&q=&status=&meetingId=      (q uses decisions_fts MATCH)
GET  /decisions/:id          (+ history, relations both ways, source lines)
PATCH /decisions/:id         POST /decisions/:id/approve     POST /decisions/:id/reject {reason}
POST /meetings/:id/approve-agreed
GET  /relations?projectId=&status=PENDING        POST /relations/:id/review
GET  /actions?projectId=&owner=&status=&overdue=1     PATCH /actions/:id     GET /actions/:id/history
GET  /blockers?projectId=&recurring=1    PATCH /blockers/:id
GET  /questions?projectId=&resolved=0    PATCH /questions/:id
GET  /insights/project/:id   GET /insights/meeting/:id
GET  /reports/decision-log?projectId=    GET /reports/actions?projectId=
GET  /search?projectId=&q=   (decisions + action items + transcript lines)
```

Errors use one format: `{ error: "message" }` with the correct HTTP status. Write a small error-handling middleware.

## 10. Pages (React)

Layout:
- Left sidebar: Dashboard, Meetings, Decisions, Action Items, Review Queue (with a red count), Insights.
- Top bar: project dropdown, user name, logout.
- Clean light theme with Tailwind.

Status colours, used the same way everywhere:
- PROPOSED = amber
- APPROVED = green
- MODIFIED = blue
- SUPERSEDED = grey with a strike-through title
- REJECTED = red
- Conflict alerts = red border

1. **Login / Register**
2. **Dashboard**: 4 stat cards (open actions, overdue, pending reviews, decisions this week), my action items, recent meetings, recurring blockers.
3. **Meetings**: list with status tabs. **New Meeting** form: title, project, agenda, date/time, participants (type a name + Enter to add).
4. **Live Meeting** (the main demo screen):
   - Header: title, LIVE timer, input-mode dropdown, Start / Pause / End buttons, "AI processing…" indicator with the last latency.
   - **Left column, transcript**: auto-scrolls; interim text in grey italics; speaker names in bold.
   - **Middle column, extracted items**: tabs Decisions / Actions / Blockers / Questions with counts. New cards flash briefly. A card shows the badge, owner, deadline, quote and Approve / Reject / Edit.
   - **Right column, alerts**: review cards. Each shows "Earlier decision (meeting, date)" next to "New decision", the type badge, the AI explanation, what changed (e.g. `date: 15 Mar → 1 Apr`), and Accept / Reject buttons (Keep new / Keep old / Keep both for conflicts). Recurring-blocker alerts show here too.
5. **Meeting Report**: the summary (react-markdown), transcript, items, a **Print / Save as PDF** button (hide the sidebar with `@media print` CSS), and **Download .md**.
6. **Decisions**: search box + status filter + meeting filter, as a table. **Decision Detail** shows:
   - the description and quote;
   - a status history timeline;
   - a **"decision chain"**: earlier and later versions linked through relations, e.g. "15 Mar (SUPERSEDED) → 1 Apr (APPROVED)".
7. **Action Items**: table with filters (owner, status, overdue); status changes inline with a dropdown; overdue rows in red. *Optional:* a simple Kanban view.
8. **Review Queue**: all PENDING flags for the project, using the same review card.
9. **Insights**: Recharts bar chart (open/done/overdue actions per owner), pie chart (decision statuses), line chart (decisions per meeting), the recurring blockers table, and an **accountability score** (% of action items with both an owner and a deadline).

Keep components simple: `useState`/`useEffect` + `api.js`, and socket listeners in the Live Meeting page. No Redux.

## 11. Demo data (`server/seed.js`; the demo depends on it)

Seeded:
- User `demo@decisionflow.app` / `demo1234`.
- Project **"Campus Connect App"**.
- **Meeting 1, "Sprint 1 Kickoff"**: ENDED, dated 14 days ago, participants Priya, Ravi, Sneha, Arjun, with its transcript (from `demo/meeting1_kickoff.txt`). It has these APPROVED decisions:
  - "Launch the beta on 15 March"
  - "Use SQLite for the prototype database"
  - "Login will support email OTP only"
- Meeting 1 action items:
  - "Ravi to finish login API by Friday"
  - "Sneha to design onboarding screens by next Wednesday"
- Meeting 1 blocker: "Waiting for college SMTP server access".
- **Meeting 2, "Sprint 2 Planning"**: SCHEDULED, same participants. It is run live in the demo with `demo/meeting2_followup.txt`, which must contain:
  - "Given the testing delays, let's move the beta launch to 1 April." → flagged against 15 March
  - "We've decided to add Google sign-in along with OTP." → flagged against "email OTP only"
  - "We're still waiting on the SMTP access from the college IT team." → recurring blocker
  - "Arjun will write regression tests for the login flow by 25 March." → action item with owner and deadline
  - "Should we support dark mode in the beta?" (no answer) → open question
  - normal chit-chat lines that must **not** be extracted
- `demo/meeting3_review.txt`: a short follow-up that answers the dark-mode question and says the SMTP issue is solved.

Each demo file has 25–40 lines in the format `Name: sentence`.

## 12. Not in scope (future work, as listed in the abstract)
Calendar integration, email/push notifications, automatic speaker identification, Zoom/Teams integration, multiple languages, mobile app.
