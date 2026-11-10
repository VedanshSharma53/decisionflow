# DecisionFlow — Architecture

This document describes how the pieces fit together. The full product rules live in [SPEC.md](SPEC.md).

## Component overview

```mermaid
flowchart LR
  subgraph Browser["Browser (React + Vite)"]
    UI[Pages + components]
    Speech[Web Speech API]
    SockC[socket.io-client]
    APIClient[api.js JWT fetch]
  end

  subgraph Server["Node.js server"]
    Express[Express REST /api]
    IO[Socket.IO]
    Extract[extraction.js]
    Conflicts[conflicts.js]
    Blockers[blockers.js]
    Reports[reports.js]
    Life[lifecycle.js]
    AI[ai.js Claude or mock]
    DB[(SQLite decisionflow.db)]
  end

  UI --> APIClient
  UI --> SockC
  Speech --> SockC
  APIClient --> Express
  SockC <--> IO
  Express --> Life
  Express --> Reports
  IO --> Extract
  Extract --> AI
  Extract --> Conflicts
  Extract --> Blockers
  Conflicts --> AI
  Extract --> DB
  Conflicts --> DB
  Blockers --> DB
  Life --> DB
  Reports --> AI
  Reports --> DB
  Express --> DB
```

| Layer | Responsibility |
|---|---|
| **client/** | Login, project switcher, Live Meeting UI, review cards, charts, reports. Talks to the server over REST + Socket.IO. Never holds the Anthropic API key. |
| **server/routes/** | Thin HTTP handlers. Validate input, call services, return JSON `{ error }` on failure. |
| **server/services/** | Business logic: extraction buffering, conflict detection, recurring blockers, reports, decision/action lifecycle. |
| **server/schema.sql** | All tables + FTS5 indexes. Applied on every server start with `IF NOT EXISTS`. |
| **demo/** | Scripted transcripts (`Name: sentence`) for safe demos without a mic. |

## Live meeting sequence

What happens when a final transcript line arrives during a LIVE meeting:

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Socket.IO
  participant Seg as segments.js
  participant Ext as extraction.js
  participant AI as ai.js / mock
  participant DB as SQLite
  participant C as conflicts.js

  B->>S: segment:final {meetingId, text, speaker}
  S->>Seg: saveFinalSegment
  Seg->>DB: INSERT segments
  S-->>B: transcript:final {segment}
  Seg->>Ext: onSegmentSaved(segment)
  Note over Ext: Buffer until ≥4 lines or 20s
  Ext->>S: ai:status processing
  Ext->>AI: extract NEW lines (+ context)
  AI-->>Ext: decisions / actions / blockers / questions
  Ext->>DB: INSERT items (confidence ≥ 0.5)
  Ext-->>B: item:created (each item)
  Ext->>C: check(newDecision) async
  C->>DB: score similar older decisions
  C->>AI: compare candidates
  C->>DB: INSERT relations PENDING
  C-->>B: relation:flagged
  Ext->>S: ai:status idle
```

## Conflict / review sequence

```mermaid
sequenceDiagram
  participant U as User
  participant UI as ReviewCard
  participant API as POST /relations/:id/review
  participant Life as lifecycle.js
  participant DB as SQLite
  participant Sock as Socket.IO room

  U->>UI: Accept (or Keep new / old / both)
  UI->>API: { action, resolution?, note? }
  API->>DB: BEGIN transaction
  alt DUPLICATE
    API->>Life: new → REJECTED
  else MODIFIES
    API->>Life: old → MODIFIED
    API->>Life: new → APPROVED
  else SUPERSEDES / KEEP_NEW
    API->>Life: old → SUPERSEDED
    API->>Life: new → APPROVED
  else KEEP_OLD
    API->>Life: new → REJECTED
  else REJECT flag / KEEP_BOTH
    Note over API: statuses unchanged
  end
  API->>DB: relations.review_status = ACCEPTED/REJECTED
  API->>DB: COMMIT
  API-->>Sock: item:updated + relation:reviewed
  Sock-->>UI: badges update live
```

**Important rule:** the AI never changes a decision status. Only `lifecycle.js` does, and only through allowed transitions (SPEC §4). Invalid transitions return HTTP 409.

## Real-time rooms

- Each meeting is a Socket.IO room named `meeting:<id>`.
- Clients send the JWT in `io(url, { auth: { token } })`.
- Anyone who opens the Live Meeting page joins the room and sees the same transcript and cards. Only the host's browser runs the microphone.

## AI modes

| Mode | When | Behaviour |
|---|---|---|
| `AI_MODE=mock` (default) | No key, or explicit mock | Regex extraction + keyword comparison + template reports |
| `AI_MODE=claude` | `ANTHROPIC_API_KEY` set | Official `@anthropic-ai/sdk` with `zodOutputFormat` schemas |

Every AI/mock run is logged in `ai_runs` (kind, latency, OK/FAILED).
