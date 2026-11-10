-- DecisionFlow database schema (SQLite). See docs/SPEC.md section 5.
-- This file runs every time the server starts. "IF NOT EXISTS" makes that safe.
-- Arrays (keywords, segment ids) are stored as JSON text. Dates are ISO strings.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- meetings
CREATE TABLE IF NOT EXISTS meetings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  title        TEXT NOT NULL,
  agenda       TEXT,
  scheduled_at TEXT,
  started_at   TEXT,
  ended_at     TEXT,
  status       TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','ENDED')),
  host_user_id INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL
);

-- One row per final transcript line
CREATE TABLE IF NOT EXISTS segments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  speaker    TEXT,
  text       TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('MIC','MANUAL','UPLOAD','DEMO')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (meeting_id, seq)
);

-- ---------------------------------------------------------------- decisions
CREATE TABLE IF NOT EXISTS decisions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  meeting_id         INTEGER NOT NULL REFERENCES meetings(id),
  title              TEXT NOT NULL,
  description        TEXT,
  topic              TEXT,
  keywords           TEXT NOT NULL DEFAULT '[]',
  certainty          TEXT NOT NULL DEFAULT 'AGREED' CHECK (certainty IN ('AGREED','TENTATIVE')),
  status             TEXT NOT NULL DEFAULT 'PROPOSED'
                     CHECK (status IN ('PROPOSED','APPROVED','MODIFIED','SUPERSEDED','REJECTED')),
  confidence         REAL,
  owner              TEXT,
  source_quote       TEXT,
  source_segment_ids TEXT NOT NULL DEFAULT '[]',
  superseded_by_id   INTEGER REFERENCES decisions(id),
  approved_by        INTEGER REFERENCES users(id),
  approved_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_decisions_project_status ON decisions(project_id, status);

-- Every status change of a decision (nothing is ever deleted)
CREATE TABLE IF NOT EXISTS decision_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL REFERENCES decisions(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,
  relation_id INTEGER REFERENCES relations(id),
  changed_by  INTEGER REFERENCES users(id),   -- NULL = system / AI
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI-flagged links between a new decision and an older one, waiting for human review
CREATE TABLE IF NOT EXISTS relations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  new_decision_id INTEGER NOT NULL REFERENCES decisions(id),
  old_decision_id INTEGER NOT NULL REFERENCES decisions(id),
  type            TEXT NOT NULL CHECK (type IN ('DUPLICATE','MODIFIES','SUPERSEDES','CONFLICTS')),
  explanation     TEXT,
  confidence      REAL,
  changed_fields  TEXT NOT NULL DEFAULT '[]',  -- JSON list: [{"field":"date","from":"15 March","to":"1 April"}]
  review_status   TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING','ACCEPTED','REJECTED')),
  resolution      TEXT CHECK (resolution IS NULL OR resolution IN ('KEEP_NEW','KEEP_OLD','KEEP_BOTH')),
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (new_decision_id, old_decision_id)
);

-- ---------------------------------------------------------------- action items
CREATE TABLE IF NOT EXISTS action_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  meeting_id         INTEGER NOT NULL REFERENCES meetings(id),
  title              TEXT NOT NULL,
  description        TEXT,
  owner              TEXT,
  deadline           TEXT,          -- YYYY-MM-DD
  deadline_text      TEXT,          -- the exact words, e.g. "by next Friday"
  status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','BLOCKED')),
  priority           TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH')),
  confidence         REAL,
  source_quote       TEXT,
  source_segment_ids TEXT NOT NULL DEFAULT '[]',
  completed_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS action_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id  INTEGER NOT NULL REFERENCES action_items(id),
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- blockers & questions
CREATE TABLE IF NOT EXISTS blockers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  meeting_id   INTEGER NOT NULL REFERENCES meetings(id),
  description  TEXT NOT NULL,
  owner        TEXT,
  keywords     TEXT NOT NULL DEFAULT '[]',
  group_id     INTEGER,             -- id of the first similar blocker (recurring blockers share it)
  resolved     INTEGER NOT NULL DEFAULT 0,
  source_quote TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id             INTEGER NOT NULL REFERENCES projects(id),
  meeting_id             INTEGER NOT NULL REFERENCES meetings(id),
  question               TEXT NOT NULL,
  raised_by              TEXT,
  resolved               INTEGER NOT NULL DEFAULT 0,
  resolved_in_meeting_id INTEGER REFERENCES meetings(id),
  source_quote           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- reports & AI log
CREATE TABLE IF NOT EXISTS reports (
  meeting_id INTEGER PRIMARY KEY REFERENCES meetings(id),
  summary_md TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER REFERENCES meetings(id),
  kind       TEXT NOT NULL CHECK (kind IN ('EXTRACT','COMPARE','SUMMARY')),
  latency_ms INTEGER,
  status     TEXT NOT NULL CHECK (status IN ('OK','FAILED')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- full-text search (FTS5)
-- "External content" tables: the text lives in decisions/segments, the triggers keep the index in sync.
CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  title, description, topic, content='decisions', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, title, description, topic) VALUES (new.id, new.title, new.description, new.topic);
END;
CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, title, description, topic)
  VALUES ('delete', old.id, old.title, old.description, old.topic);
END;
CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE OF title, description, topic ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, title, description, topic)
  VALUES ('delete', old.id, old.title, old.description, old.topic);
  INSERT INTO decisions_fts(rowid, title, description, topic) VALUES (new.id, new.title, new.description, new.topic);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  text, content='segments', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE OF text ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
