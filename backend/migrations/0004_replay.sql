-- Context of a branch that has no user message of its own yet (set by "branch from here" with context changes).
-- The first user message sent on the timeline takes this context; the rows are deleted when it is created.
-- See docs/phases/3. Draft.md, "Replay flow and branch view".

CREATE TABLE timeline_context (
  timeline_id  INTEGER NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  card_id      INTEGER NOT NULL REFERENCES cards(id),
  card_version INTEGER NOT NULL,
  state        TEXT    NOT NULL DEFAULT 'included'
               CHECK (state IN ('included','pinned','excluded')),
  position     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (timeline_id, card_id),
  FOREIGN KEY (card_id, card_version) REFERENCES card_versions(card_id, version)
) STRICT;
