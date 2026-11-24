import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { AppError } from '../common/errors.ts'
import { transaction } from '../db/index.ts'
import type {
  Card,
  CardKind,
  CardSummary,
  CardVersion,
  GraphNode,
  Link,
  LinkKind,
  ReviewStatus,
} from './schema.ts'

type Row = Record<string, unknown>

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
const EXCERPT_LENGTH = 200

const cardNotFound = (id: number) => new AppError(404, 'card_not_found', `Card c${id} not found`)
const linkNotFound = (id: number) => new AppError(404, 'link_not_found', `Link ${id} not found`)

function toLink(row: Row): Link {
  return {
    id: row.id as number,
    sourceId: row.source_id as number,
    targetId: row.target_id as number,
    kind: row.kind as LinkKind,
    label: row.label as string | null,
    createdAt: row.created_at as string,
  }
}

function toBase(row: Row): Omit<CardSummary, 'excerpt'> {
  return {
    id: row.id as number,
    title: row.title as string,
    kind: row.kind as CardKind,
    folderPath: row.folder_path as string,
    defaultIncluded: row.default_included === 1,
    version: row.version as number,
    mergedInto: row.merged_into_id as number | null,
    archivedAt: row.archived_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    origin: row.origin as 'agent' | null,
    reviewStatus: row.review_status as ReviewStatus | null,
  }
}

const toSummary = (row: Row): CardSummary => ({ ...toBase(row), excerpt: (row.body as string).slice(0, EXCERPT_LENGTH) })

export type NewCard = {
  title: string
  body: string
  kind: CardKind
  folderPath: string
  defaultIncluded: boolean
  /** Only set for uploaded files. */
  sourceName?: string
  mimeType?: string
  /** Only set for cards recorded by a Claude Code session. */
  agent?: { sessionId: number; reviewStatus: ReviewStatus }
}

export type CardChanges = Partial<Omit<NewCard, 'agent'>> & { ifVersion?: number }

export type CardFilter = {
  query?: string
  kind?: CardKind
  folder?: string
  includeArchived: boolean
}

export function createCardRepository(db: DatabaseSync) {
  const rowOf = (id: number): Row => {
    const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id)
    if (!row) throw cardNotFound(id)
    return row
  }

  /** Follows `merged_into_id` to the card that finally survived (a card merged into a card that was merged again). */
  function finalTarget(start: number | null): number | null {
    let current = start
    for (let hops = 0; current !== null && hops < 100; hops++) {
      const next = db.prepare('SELECT merged_into_id FROM cards WHERE id = ?').get(current)?.merged_into_id as
        | number
        | null
        | undefined
      if (next === null || next === undefined) break
      current = next
    }
    return current
  }

  function get(id: number): Card {
    const row = rowOf(id)
    const links = db.prepare('SELECT * FROM card_links WHERE source_id = ? ORDER BY id').all(id).map(toLink)
    const backlinks = db.prepare('SELECT * FROM card_links WHERE target_id = ? ORDER BY id').all(id).map(toLink)
    return {
      ...toBase(row),
      mergedInto: finalTarget(row.merged_into_id as number | null),
      body: row.body as string,
      sourceName: row.source_name as string | null,
      mimeType: row.mime_type as string | null,
      forkedFromId: row.forked_from_id as number | null,
      links,
      backlinks,
    }
  }

  const linkRow = (id: number): Row => {
    const row = db.prepare('SELECT * FROM card_links WHERE id = ?').get(id)
    if (!row) throw linkNotFound(id)
    return row
  }

  /** `related` counts as undirected: (a,b) and (b,a) are the same link. */
  const relatedExists = (a: number, b: number, exceptId = 0): boolean =>
    db
      .prepare(
        `SELECT 1 FROM card_links WHERE kind = 'related' AND id <> ?
         AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))`,
      )
      .get(exceptId, a, b, b, a) !== undefined

  return {
    create(input: NewCard): Card {
      return transaction(db, () => {
        const result = db
          .prepare(
            'INSERT INTO cards (title, body, kind, folder_path, default_included, source_name, mime_type, origin, review_status, code_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            input.title,
            input.body,
            input.kind,
            input.folderPath,
            input.defaultIncluded ? 1 : 0,
            input.sourceName ?? null,
            input.mimeType ?? null,
            input.agent ? 'agent' : null,
            input.agent?.reviewStatus ?? null,
            input.agent?.sessionId ?? null,
          )
        const id = Number(result.lastInsertRowid)
        db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, 1, ?, ?)').run(
          id,
          input.title,
          input.body,
        )
        return get(id)
      })
    },

    get,

    list(filter: CardFilter): CardSummary[] {
      const where: string[] = []
      const values: SQLInputValue[] = []
      if (!filter.includeArchived) where.push('archived_at IS NULL')
      if (filter.kind) {
        where.push('kind = ?')
        values.push(filter.kind)
      }
      if (filter.folder !== undefined) {
        where.push("(folder_path = ? OR folder_path LIKE ? ESCAPE '\\')")
        values.push(filter.folder, `${escapeLike(filter.folder)}/%`)
      }
      if (filter.query) {
        where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')")
        const pattern = `%${escapeLike(filter.query)}%`
        values.push(pattern, pattern)
      }
      const sql = `SELECT * FROM cards ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
      return db.prepare(sql).all(...values).map(toSummary)
    },

    /** Changing title or body writes a new version row; moving or flagging a card does not. */
    update(id: number, changes: CardChanges): Card {
      return transaction(db, () => {
        const row = rowOf(id)
        if (row.archived_at !== null) throw new AppError(409, 'card_archived', `Card c${id} is archived`)
        if (changes.ifVersion !== undefined && changes.ifVersion !== row.version) {
          throw new AppError(409, 'version_conflict', `Card c${id} is at version ${row.version}, not ${changes.ifVersion}`, {
            currentVersion: row.version,
          })
        }
        const title = changes.title ?? (row.title as string)
        const body = changes.body ?? (row.body as string)
        const textChanged = title !== row.title || body !== row.body
        const version = textChanged ? (row.version as number) + 1 : (row.version as number)
        db.prepare(
          `UPDATE cards SET title = ?, body = ?, kind = ?, folder_path = ?, default_included = ?, version = ?,
           updated_at = ${NOW} WHERE id = ?`,
        ).run(
          title,
          body,
          changes.kind ?? (row.kind as string),
          changes.folderPath ?? (row.folder_path as string),
          changes.defaultIncluded === undefined ? (row.default_included as number) : changes.defaultIncluded ? 1 : 0,
          version,
          id,
        )
        if (textChanged) {
          db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, ?, ?, ?)').run(
            id,
            version,
            title,
            body,
          )
        }
        return get(id)
      })
    },

    /** Soft delete. Archiving an archived card does nothing. */
    archive(id: number): void {
      rowOf(id)
      db.prepare(`UPDATE cards SET archived_at = ${NOW}, updated_at = ${NOW} WHERE id = ? AND archived_at IS NULL`).run(id)
    },

    restore(id: number): Card {
      const row = rowOf(id)
      if (row.merged_into_id !== null) {
        throw new AppError(409, 'card_merged', `Card c${id} was merged into c${row.merged_into_id}; undo the merge instead`)
      }
      db.prepare(`UPDATE cards SET archived_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id)
      return get(id)
    },

    versions(id: number): CardVersion[] {
      rowOf(id)
      return db
        .prepare('SELECT version, title, body, created_at FROM card_versions WHERE card_id = ? ORDER BY version DESC')
        .all(id)
        .map((r) => ({
          version: r.version as number,
          title: r.title as string,
          body: r.body as string,
          createdAt: r.created_at as string,
        }))
    },

    createLink(input: { sourceId: number; targetId: number; kind: LinkKind; label: string | null }): Link {
      if (input.sourceId === input.targetId) {
        throw new AppError(400, 'invalid_link', 'A card cannot be linked to itself')
      }
      for (const id of [input.sourceId, input.targetId]) {
        if (rowOf(id).archived_at !== null) throw new AppError(409, 'card_archived', `Card c${id} is archived`)
      }
      const exists =
        input.kind === 'related'
          ? relatedExists(input.sourceId, input.targetId)
          : db
              .prepare('SELECT 1 FROM card_links WHERE source_id = ? AND target_id = ? AND kind = ?')
              .get(input.sourceId, input.targetId, input.kind) !== undefined
      if (exists) throw new AppError(409, 'link_exists', `c${input.sourceId} and c${input.targetId} are already linked`)
      const result = db
        .prepare('INSERT INTO card_links (source_id, target_id, kind, label) VALUES (?, ?, ?, ?)')
        .run(input.sourceId, input.targetId, input.kind, input.label)
      return toLink(linkRow(Number(result.lastInsertRowid)))
    },

    updateLink(id: number, changes: { kind?: LinkKind; label?: string | null }): Link {
      const row = linkRow(id)
      const kind = changes.kind ?? (row.kind as LinkKind)
      const label = changes.label === undefined ? (row.label as string | null) : changes.label
      const source = row.source_id as number
      const target = row.target_id as number
      const taken =
        kind === 'related'
          ? relatedExists(source, target, id)
          : db
              .prepare('SELECT 1 FROM card_links WHERE source_id = ? AND target_id = ? AND kind = ? AND id <> ?')
              .get(source, target, kind, id) !== undefined
      if (taken) throw new AppError(409, 'link_exists', `c${source} and c${target} are already linked with kind ${kind}`)
      db.prepare('UPDATE card_links SET kind = ?, label = ? WHERE id = ?').run(kind, label, id)
      return toLink(linkRow(id))
    },

    deleteLink(id: number): void {
      linkRow(id)
      db.prepare('DELETE FROM card_links WHERE id = ?').run(id)
    },

    /** Active cards as nodes, and the links between them (both ends must be nodes of the result). */
    graph(filter: { folder?: string; kind?: CardKind }): { nodes: GraphNode[]; links: Link[] } {
      const where = ['archived_at IS NULL']
      const values: SQLInputValue[] = []
      if (filter.kind) {
        where.push('kind = ?')
        values.push(filter.kind)
      }
      if (filter.folder !== undefined) {
        where.push("(folder_path = ? OR folder_path LIKE ? ESCAPE '\\')")
        values.push(filter.folder, `${escapeLike(filter.folder)}/%`)
      }
      const cards = db.prepare(`SELECT * FROM cards WHERE ${where.join(' AND ')} ORDER BY id`).all(...values)
      const ids = new Set(cards.map((c) => c.id as number))
      const links = db
        .prepare('SELECT * FROM card_links ORDER BY id')
        .all()
        .map(toLink)
        .filter((l) => ids.has(l.sourceId) && ids.has(l.targetId))
      const degree = new Map<number, number>()
      for (const l of links) {
        degree.set(l.sourceId, (degree.get(l.sourceId) ?? 0) + 1)
        degree.set(l.targetId, (degree.get(l.targetId) ?? 0) + 1)
      }
      const nodes = cards.map((c) => ({
        id: c.id as number,
        title: c.title as string,
        kind: c.kind as CardKind,
        folderPath: c.folder_path as string,
        x: c.graph_x as number | null,
        y: c.graph_y as number | null,
        degree: degree.get(c.id as number) ?? 0,
        origin: c.origin as 'agent' | null,
        reviewStatus: c.review_status as ReviewStatus | null,
      }))
      return { nodes, links }
    },

    /** Stores node positions; all or none (unknown card ids fail the whole batch). */
    setPositions(positions: { id: number; x: number; y: number }[]): void {
      transaction(db, () => {
        const update = db.prepare('UPDATE cards SET graph_x = ?, graph_y = ? WHERE id = ?')
        for (const p of positions) {
          if (update.run(p.x, p.y, p.id).changes === 0) throw cardNotFound(p.id)
        }
      })
    },
  }
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export type CardRepository = ReturnType<typeof createCardRepository>
