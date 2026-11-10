# DecisionFlow — Database

SQLite file: `server/data/decisionflow.db`. Schema: `server/schema.sql` (runs on every server start).

Pragmas: `foreign_keys = ON`, `journal_mode = WAL`.

## ER diagram

```mermaid
erDiagram
  users ||--o{ meetings : hosts
  projects ||--o{ meetings : has
  projects ||--o{ decisions : has
  projects ||--o{ action_items : has
  projects ||--o{ blockers : has
  projects ||--o{ questions : has
  meetings ||--o{ participants : has
  meetings ||--o{ segments : has
  meetings ||--o{ decisions : produces
  meetings ||--o{ action_items : produces
  meetings ||--o{ blockers : produces
  meetings ||--o{ questions : produces
  meetings ||--o| reports : has
  decisions ||--o{ decision_history : tracks
  decisions ||--o{ relations : new_side
  decisions ||--o{ relations : old_side
  action_items ||--o{ action_history : tracks
  blockers }o--o| blockers : group_id

  users {
    int id PK
    text name
    text email UK
    text password_hash
  }
  projects {
    int id PK
    text name
    text description
  }
  meetings {
    int id PK
    int project_id FK
    text title
    text status
    text scheduled_at
    text started_at
    text ended_at
  }
  segments {
    int id PK
    int meeting_id FK
    int seq
    text speaker
    text text
    text source
  }
  decisions {
    int id PK
    int project_id FK
    int meeting_id FK
    text title
    text topic
    text status
    text certainty
    real confidence
  }
  relations {
    int id PK
    int new_decision_id FK
    int old_decision_id FK
    text type
    text review_status
  }
  action_items {
    int id PK
    int project_id FK
    int meeting_id FK
    text title
    text owner
    text deadline
    text status
  }
  blockers {
    int id PK
    int project_id FK
    int meeting_id FK
    text description
    int group_id
    int resolved
  }
  questions {
    int id PK
    int meeting_id FK
    text question
    int resolved
  }
  reports {
    int meeting_id PK
    text summary_md
  }
```

## Table summary

| Table | Purpose |
|---|---|
| `users` | Login accounts (`email` unique, `password_hash` via bcrypt). |
| `projects` | Top-level container. Most list APIs filter by `project_id`. |
| `meetings` | `SCHEDULED` → `LIVE` → `ENDED`. Host is `host_user_id`. |
| `participants` | Display names for the speaker dropdown / owner matching. |
| `segments` | Final transcript lines. `source` ∈ MIC, MANUAL, UPLOAD, DEMO. |
| `decisions` | Extracted decisions. Status lifecycle in SPEC §4. Keywords stored as JSON text. |
| `decision_history` | Append-only status changes. `changed_by` NULL = system. |
| `relations` | AI/mock flags between a new and an older decision. Unique `(new, old)`. |
| `action_items` | Tasks with optional owner + `deadline` (YYYY-MM-DD). |
| `action_history` | Field-level changes (status / owner / deadline). |
| `blockers` | Impediments. `group_id` links recurring mentions across meetings. |
| `questions` | Open questions; `resolved` + optional `resolved_in_meeting_id`. |
| `reports` | One Markdown summary per meeting (`meeting_id` PK). |
| `ai_runs` | Latency/status log for EXTRACT / COMPARE / SUMMARY. |
| `decisions_fts` / `segments_fts` | FTS5 external-content indexes (kept in sync by triggers). |

## Status values

**Decision:** `PROPOSED` → `APPROVED` | `REJECTED`; `APPROVED` → `MODIFIED` | `SUPERSEDED`.

**Action item:** `OPEN`, `IN_PROGRESS`, `DONE`, `BLOCKED`. Overdue = `deadline < today` and status ≠ `DONE`.

**Relation type:** `DUPLICATE`, `MODIFIES`, `SUPERSEDES`, `CONFLICTS`.  
**Relation review:** `PENDING` → `ACCEPTED` | `REJECTED`.

## Notes for viva

- Arrays (`keywords`, `source_segment_ids`, `changed_fields`) are JSON text, not separate tables — keeps the schema small for a prototype.
- Nothing important is deleted: status changes go to history tables; rejecting a relation only flips `review_status`.
- All user-facing SQL uses prepared statements (`db.prepare(...).run/?get/?all`).
