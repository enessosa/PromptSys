// Changes to the context at a branch point: card states, added cards and edits (which create forked cards).
import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../common/errors.ts'
import type { ChatRepository } from './repository.ts'
import type { ContextChanges, ContextEntry } from './schema.ts'

const invalid = (path: string, message: string) => new AppError(400, 'validation_failed', `${path}: ${message}`, [{ path, message }])

/**
 * Inserts the fork of a card: a new card with `forked_from_id`, its first version and a `derived_from` link
 * (fork → original). The original card stays unchanged for all other timelines.
 */
function forkCard(db: DatabaseSync, entry: ContextEntry, edit: { title?: string; body?: string }): number {
  const row = db
    .prepare('SELECT c.kind AS kind, c.folder_path AS folder_path, v.title AS title, v.body AS body FROM cards c JOIN card_versions v ON v.card_id = c.id AND v.version = ? WHERE c.id = ?')
    .get(entry.version, entry.cardId)
  if (!row) throw new AppError(404, 'card_not_found', `Card c${entry.cardId} not found`)
  const title = edit.title ?? (row.title as string)
  const body = edit.body ?? (row.body as string)
  const { lastInsertRowid } = db
    .prepare('INSERT INTO cards (title, body, kind, folder_path, default_included, forked_from_id) VALUES (?, ?, ?, ?, 0, ?)')
    .run(title, body, row.kind as string, row.folder_path as string, entry.cardId)
  const forkId = Number(lastInsertRowid)
  db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, 1, ?, ?)').run(forkId, title, body)
  db.prepare("INSERT INTO card_links (source_id, target_id, kind, label) VALUES (?, ?, 'derived_from', 'edited in a branch')").run(forkId, entry.cardId)
  return forkId
}

/**
 * Applies `changes` to the context a branch starts from.
 * - `cards`: sets the state of a card in the context; a card that is not in it yet is added (current version, last position).
 * - `editedCards`: the card must be in the context; a fork with the new text replaces it (same position and state).
 * With `persist = false` (dry run) everything is validated but no card is created; forks then keep the original id.
 * Run inside a transaction when `persist` is true. `summary` is `null` when nothing changed.
 */
export function applyContextChanges(
  db: DatabaseSync,
  repo: ChatRepository,
  base: ContextEntry[],
  changes: ContextChanges,
  persist: boolean,
): { context: ContextEntry[]; summary: string | null } {
  const context = new Map(base.map((e) => [e.cardId, { ...e }]))
  const parts: string[] = []

  const seen = new Set<number>()
  for (const { cardId, state } of changes.cards) {
    if (seen.has(cardId)) throw invalid('contextChanges.cards', `duplicate card c${cardId}`)
    seen.add(cardId)
    const existing = context.get(cardId)
    if (existing) {
      if (existing.state === state) continue
      existing.state = state
      parts.push(`${state} c${cardId}`)
    } else {
      const [added] = repo.explicitContext([{ cardId, state }]) // checks that the card exists and is usable
      const position = Math.max(-1, ...[...context.values()].map((e) => e.position)) + 1
      context.set(cardId, { ...added, position })
      parts.push(`added c${cardId}`)
    }
  }

  const edited = new Set<number>()
  for (const edit of changes.editedCards) {
    if (edited.has(edit.cardId)) throw invalid('contextChanges.editedCards', `duplicate card c${edit.cardId}`)
    edited.add(edit.cardId)
    const entry = context.get(edit.cardId)
    if (!entry) throw invalid('contextChanges.editedCards', `card c${edit.cardId} is not part of the context here`)
    const forkId = persist ? forkCard(db, entry, edit) : edit.cardId
    context.delete(edit.cardId)
    context.set(forkId, { cardId: forkId, version: persist ? 1 : entry.version, state: entry.state, position: entry.position })
    parts.push(persist ? `edited c${edit.cardId} → c${forkId}` : `edited c${edit.cardId}`)
  }

  const result = [...context.values()].sort((a, b) => a.position - b.position || a.cardId - b.cardId)
  return { context: result, summary: parts.length > 0 ? parts.join(', ') : null }
}
