-- Agent mode: images the user pasted into a message. Stored once, referenced by id from the `user` event.
CREATE TABLE code_images (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES code_sessions(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/gif','image/webp')),
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX code_images_session ON code_images(session_id);
