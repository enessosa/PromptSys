-- Derived rules, ablation runs and non-secret settings. See docs/phases/3. Draft.md, "Database schema".

CREATE TABLE derived_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id        INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,  -- answer it was derived from
  text              TEXT    NOT NULL,
  source_kind       TEXT    NOT NULL CHECK (source_kind IN ('card','prior_knowledge')),
  source_card_id    INTEGER REFERENCES cards(id),             -- set when source_kind = 'card'
  status            TEXT    NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','confirmed','corrected','rejected')),
  corrected_card_id INTEGER REFERENCES cards(id),             -- rule card created by a correction or by "save as card"
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((source_kind = 'card') = (source_card_id IS NOT NULL))
) STRICT;

CREATE INDEX idx_derived_rules_conversation ON derived_rules(conversation_id);
CREATE INDEX idx_derived_rules_message ON derived_rules(message_id);

CREATE TABLE ablation_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,   -- original assistant answer
  card_id       INTEGER REFERENCES cards(id),                 -- NULL = baseline run (all cards, measures noise)
  run_index     INTEGER NOT NULL,                             -- 1..n
  answer        TEXT    NOT NULL,
  similarity    REAL,                                         -- cosine similarity to the original answer
  temperature   REAL    NOT NULL,
  model         TEXT    NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (message_id, card_id, run_index)
) STRICT;

CREATE INDEX idx_ablation_runs_message ON ablation_runs(message_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
) STRICT;
