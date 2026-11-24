-- Conversations, timelines, messages, per-message context state and citations. See docs/phases/3. Draft.md, "Database schema".
-- derived_rules, ablation_runs and settings follow in later migrations.

CREATE TABLE conversations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT    NOT NULL DEFAULT 'New conversation',
  system_prompt        TEXT    NOT NULL DEFAULT '',          -- user-level instructions; PromptSys adds its own
  model                TEXT,                                 -- NULL = default model from settings
  active_timeline_id   INTEGER,                              -- timeline shown by default (no FK: circular)
  show_derived_rules   INTEGER NOT NULL DEFAULT 0 CHECK (show_derived_rules IN (0,1)),
  archived_at          TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id     INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id           INTEGER REFERENCES messages(id) ON DELETE CASCADE,  -- NULL = first message
  role                TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content             TEXT    NOT NULL DEFAULT '',
  status              TEXT    NOT NULL DEFAULT 'complete'
                      CHECK (status IN ('streaming','complete','stopped','error')),
  replay_of_id        INTEGER REFERENCES messages(id) ON DELETE SET NULL, -- original message this one replays
  model               TEXT,                                   -- assistant only
  stop_reason         TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  error_code          TEXT,                                   -- see error codes
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE INDEX idx_messages_parent ON messages(conversation_id, parent_id);

CREATE TABLE timelines (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id      INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name                 TEXT    NOT NULL DEFAULT 'main',
  parent_timeline_id   INTEGER REFERENCES timelines(id) ON DELETE SET NULL,
  branch_point_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,  -- NULL for the first timeline
  head_message_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,  -- latest message of this timeline
  change_summary       TEXT,                                   -- e.g. 'excluded c4, edited c7' shown at the branch point
  -- replay state (NULL replay_status = ordinary timeline)
  replay_status        TEXT    CHECK (replay_status IN ('paused','running','finished','branched_off','cancelled')),
  replay_mode          TEXT    CHECK (replay_mode IN ('step','auto')),
  replay_source_id     INTEGER REFERENCES timelines(id) ON DELETE SET NULL, -- timeline whose prompts are replayed
  replay_next_id       INTEGER REFERENCES messages(id) ON DELETE SET NULL,  -- next original user message to replay
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE INDEX idx_timelines_conv ON timelines(conversation_id);

CREATE TABLE message_cards (
  message_id   INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,  -- user message
  card_id      INTEGER NOT NULL REFERENCES cards(id),
  card_version INTEGER NOT NULL,                              -- exact text that was / will be sent
  state        TEXT    NOT NULL DEFAULT 'included'
               CHECK (state IN ('included','pinned','excluded')),
  position     INTEGER NOT NULL DEFAULT 0,                    -- order inside the prompt
  PRIMARY KEY (message_id, card_id),
  FOREIGN KEY (card_id, card_version) REFERENCES card_versions(card_id, version)
) STRICT;

CREATE TABLE citations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id   INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,  -- assistant message
  card_id      INTEGER REFERENCES cards(id),                  -- NULL if the marker names an unknown card
  raw_marker   TEXT    NOT NULL,                              -- e.g. '[c3]'
  start_offset INTEGER NOT NULL,                              -- position in messages.content (UTF-16 code units)
  end_offset   INTEGER NOT NULL,
  valid        INTEGER NOT NULL CHECK (valid IN (0,1))        -- 0 = unknown card or not part of this prompt
) STRICT;

CREATE INDEX idx_citations_message ON citations(message_id);
