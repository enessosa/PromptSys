import type { DatabaseSync } from 'node:sqlite'

const LIMIT = 20
const EXCERPT_LENGTH = 120

/**
 * Search for the command palette: cards (title or body) and conversations (title) that contain the text.
 * Plain `LIKE`, so it is case-insensitive for ASCII letters only. Archived and merged-away cards are not listed.
 */
export function search(db: DatabaseSync, q: string) {
  if (q === '') return { cards: [], conversations: [] }
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const cards = db
    .prepare(
      `SELECT id, title, kind, folder_path, substr(body, 1, ?) AS excerpt
         FROM cards
        WHERE archived_at IS NULL AND merged_into_id IS NULL
          AND (title LIKE ?2 ESCAPE '\\' OR body LIKE ?2 ESCAPE '\\')
        ORDER BY (title LIKE ?2 ESCAPE '\\') DESC, updated_at DESC, id DESC
        LIMIT ${LIMIT}`,
    )
    .all(EXCERPT_LENGTH, like)
    .map((r) => ({ id: r.id as number, title: r.title as string, kind: r.kind as string, folderPath: r.folder_path as string, excerpt: r.excerpt as string }))
  const conversations = db
    .prepare(
      `SELECT id, title, updated_at FROM conversations
        WHERE archived_at IS NULL AND title LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC, id DESC LIMIT ${LIMIT}`,
    )
    .all(like)
    .map((r) => ({ id: r.id as number, title: r.title as string, updatedAt: r.updated_at as string }))
  return { cards, conversations }
}
