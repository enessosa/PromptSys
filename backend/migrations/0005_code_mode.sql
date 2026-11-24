-- Claude Code mode: coding-agent sessions with their event log, and agent-recorded cards that the user reviews.
-- Cards get an origin (NULL = a user card), a review status and the session that recorded them.

CREATE TABLE code_sessions (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL,
  project_path   TEXT    NOT NULL,
  sdk_session_id TEXT,
  status         TEXT    NOT NULL DEFAULT 'idle'
                 CHECK (status IN ('idle','running','waiting_approval','error','stopped')),
  slash_commands TEXT    NOT NULL DEFAULT '[]',
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE code_events (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES code_sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  payload    TEXT    NOT NULL DEFAULT '{}',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, seq)
) STRICT;

ALTER TABLE cards ADD COLUMN origin TEXT CHECK (origin IN ('agent'));
ALTER TABLE cards ADD COLUMN review_status TEXT CHECK (review_status IN ('proposed','confirmed','corrected','rejected'));
ALTER TABLE cards ADD COLUMN code_session_id INTEGER REFERENCES code_sessions(id) ON DELETE SET NULL;

CREATE INDEX idx_cards_code_session ON cards(code_session_id);
