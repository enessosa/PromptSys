-- Cards, their versions, links (graph edges) and merge history. See docs/phases/3. Draft.md, "Database schema".
-- Conventions: STRICT tables, INTEGER PRIMARY KEY AUTOINCREMENT (ids are never reused), ISO 8601 UTC timestamps.

CREATE TABLE cards (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,      -- c<id> in prompts and UI
  title            TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body             TEXT    NOT NULL DEFAULT '',
  kind             TEXT    NOT NULL DEFAULT 'note'
                   CHECK (kind IN ('note','file','memory','rule','search')),
  folder_path      TEXT    NOT NULL DEFAULT '',
  source_name      TEXT,
  mime_type        TEXT,
  default_included INTEGER NOT NULL DEFAULT 0 CHECK (default_included IN (0,1)),
  graph_x          REAL,
  graph_y          REAL,
  version          INTEGER NOT NULL DEFAULT 1,
  forked_from_id   INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  merged_into_id   INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  archived_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
) STRICT;

CREATE INDEX idx_cards_folder ON cards(folder_path) WHERE archived_at IS NULL;
CREATE INDEX idx_cards_merged ON cards(merged_into_id);

CREATE TABLE card_versions (
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (card_id, version)
) STRICT;

CREATE TABLE card_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL DEFAULT 'related'
             CHECK (kind IN ('related','derived_from','part_of','contradicts')),
  label      TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (source_id <> target_id),
  UNIQUE (source_id, target_id, kind)
) STRICT;

CREATE INDEX idx_card_links_target ON card_links(target_id);

CREATE TABLE card_merges (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id             INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  source_id             INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  source_title          TEXT    NOT NULL,
  source_body           TEXT    NOT NULL,
  source_links          TEXT    NOT NULL DEFAULT '[]',
  target_version_before INTEGER NOT NULL,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  undone_at             TEXT,
  CHECK (target_id <> source_id)
) STRICT;

CREATE INDEX idx_card_merges_target ON card_merges(target_id);
