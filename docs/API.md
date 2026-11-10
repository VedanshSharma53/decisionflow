# DecisionFlow — API

Base URL (dev): `http://localhost:4000/api`  
Auth: `Authorization: Bearer <jwt>` on every route except register/login/health.  
Errors: `{ "error": "message" }` with the appropriate HTTP status.

The Vite client proxies `/api` and `/socket.io` to port 4000.

---

## Health

### `GET /health` (no auth)
```json
{ "ok": true, "aiMode": "mock" }
```

---

## Auth

### `POST /auth/register`
```json
// request
{ "name": "Ada", "email": "ada@example.com", "password": "secret1" }
// 201
{ "token": "<jwt>", "user": { "id": 1, "name": "Ada", "email": "ada@example.com" } }
```

### `POST /auth/login`
```json
{ "email": "demo@decisionflow.app", "password": "demo1234" }
```
→ `{ "token", "user" }`

### `GET /auth/me`
→ `{ "user": { "id", "name", "email" } }`

---

## Projects

### `GET /projects`
→ `[{ "id", "name", "description", "created_at" }]`

### `POST /projects`
```json
{ "name": "Campus Connect App", "description": "…" }
```
→ `201` project row

---

## Meetings

### `GET /meetings?projectId=1&status=LIVE`
→ list with `participant_count`, `segment_count`

### `POST /meetings`
```json
{
  "projectId": 1,
  "title": "Sprint 2 Planning",
  "agenda": "Launch date, login, blockers",
  "scheduledAt": "2026-11-11 10:00:00",
  "participants": ["Priya", "Ravi", "Sneha", "Arjun"]
}
```

### `GET /meetings/:id`
Meeting + participants + transcript + decisions/actionItems/blockers/questions + pending `relations`.

### `POST /meetings/:id/start` → status `LIVE`  
### `POST /meetings/:id/end` → status `ENDED`, flushes AI buffer, generates report

### `POST /meetings/:id/upload` (multipart `file`: .txt / .docx)

### `GET /meetings/demo-files` → `["meeting1_kickoff.txt", …]`  
### `POST /meetings/:id/demo/play` `{ "file": "meeting2_followup.txt", "speed": 4 }`  
### `POST /meetings/:id/demo/stop`

### `POST /meetings/:id/approve-agreed`  
Approves every `PROPOSED` + `AGREED` decision in the meeting.

### `GET /meetings/:id/report` → `{ meetingId, meetingTitle, summary_md, created_at }`  
### `POST /meetings/:id/report/regenerate`

---

## Decisions

### `GET /decisions?projectId=1&q=launch&status=APPROVED&meetingId=2`
Uses `decisions_fts MATCH` when `q` is set.

### `GET /decisions/:id`
Decision + `meeting` + `history` + `relations` (both ways) + `sourceLines`.

### `PATCH /decisions/:id` `{ "title", "description", "owner" }`  
### `POST /decisions/:id/approve`  
### `POST /decisions/:id/reject` `{ "reason": "Not agreed" }`

Invalid status transitions → `409`.

---

## Action items

### `GET /actions?projectId=1&owner=Ravi&status=OPEN&overdue=1`
Each row includes `overdue: true|false`.

### `GET /actions/:id` (+ history)  
### `GET /actions/:id/history`  
### `PATCH /actions/:id` `{ "status": "DONE", "owner": "Ravi", "deadline": "2026-04-01" }`  
Writes `action_history` for changed fields.

---

## Relations (conflict review)

### `GET /relations?projectId=1&status=PENDING&meetingId=2`

### `POST /relations/:id/review`
```json
{ "action": "ACCEPT", "resolution": "KEEP_NEW", "note": "Product confirmed" }
```
- `resolution` required only when type is `CONFLICTS` (`KEEP_NEW` | `KEEP_OLD` | `KEEP_BOTH`).
- Applies SPEC §4 through `lifecycle.js` inside one SQLite transaction.
→ `{ relation, newDecision, oldDecision }`

---

## Blockers

### `GET /blockers?projectId=1`  
### `GET /blockers?projectId=1&recurring=1` → recurring groups (2+ meetings)  
### `PATCH /blockers/:id` `{ "resolved": true, "owner": "Ravi" }`

---

## Insights

### `GET /insights/project/:id`
```json
{
  "stats": {
    "openActions": 2,
    "overdueActions": 2,
    "pendingReviews": 0,
    "decisionsThisWeek": 3,
    "accountabilityScore": 100
  },
  "actionsPerOwner": [{ "owner": "Ravi", "open": 1, "done": 0, "overdue": 1 }],
  "decisionStatuses": [{ "status": "APPROVED", "count": 3 }],
  "decisionsPerMeeting": [{ "meetingId": 1, "meetingTitle": "Sprint 1 Kickoff", "count": 3 }],
  "recurringBlockers": [],
  "myActionItems": [],
  "recentMeetings": []
}
```

### `GET /insights/meeting/:id` — lightweight per-meeting counts

---

## Reports (template)

### `GET /reports/decision-log?projectId=1` → `{ "markdown": "# Decision Log…" }`  
### `GET /reports/actions?projectId=1` → `{ "markdown": "# Action Item Report…" }`

---

## Search

### `GET /search?projectId=1&q=launch`
```json
{
  "q": "launch",
  "decisions": [ /* FTS hits */ ],
  "actionItems": [ /* LIKE hits */ ],
  "segments": [ /* transcript FTS hits */ ]
}
```

---

## Socket.IO events (SPEC §6)

Client → server: `meeting:join`, `segment:interim`, `segment:final`  
Server → room: `transcript:interim`, `transcript:final`, `item:created`, `item:updated`,  
`relation:flagged`, `relation:reviewed`, `blocker:recurring`, `meeting:status`, `ai:status`
