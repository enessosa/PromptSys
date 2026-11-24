import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../common/errors.ts'
import { transaction } from '../db/index.ts'
import { createCardRepository } from './repository.ts'
import type { Card, LinkKind, Merge, MergePreview } from './schema.ts'

type Row = Record<string, unknown>

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

/** A link of a merged-away card as stored in `card_merges.source_links`. `moved` tells whether it was re-pointed (true) or dropped (false). */
type SnapshotLink = {
  id: number
  sourceId: number
  targetId: number
  kind: LinkKind
  label: string | null
  createdAt: string
  moved: boolean
}

type PlannedLink = { link: SnapshotLink; newSourceId: number; newTargetId: number }

const linkKey = (kind: string, a: number, b: number) =>
  kind === 'related' ? `related:${Math.min(a, b)}:${Math.max(a, b)}` : `${kind}:${a}:${b}`

const invalidMerge = (message: string) => new AppError(400, 'invalid_merge', message)

function toMerge(row: Row): Merge {
  return {
    id: row.id as number,
    targetId: row.target_id as number,
    sourceId: row.source_id as number,
    sourceTitle: row.source_title as string,
    targetVersionBefore: row.target_version_before as number,
    createdAt: row.created_at as string,
    undoneAt: row.undone_at as string | null,
  }
}

/** Merging cards and undoing a merge (see "Card merges" in docs/phases/3. Draft.md). */
export function createMergeRepository(db: DatabaseSync) {
  const cards = createCardRepository(db)

  /** Checks the request and returns the (de-duplicated) source ids with the loaded rows. */
  function validate(targetId: number, sourceIds: number[]) {
    const ids = [...new Set(sourceIds)]
    if (ids.length === 0) throw invalidMerge('At least one source card is required')
    if (ids.includes(targetId)) throw invalidMerge('The target card cannot also be a source')
    const rows = [targetId, ...ids].map((id) => {
      const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id)
      if (!row) throw new AppError(404, 'card_not_found', `Card c${id} not found`)
      if (row.archived_at !== null || row.merged_into_id !== null) {
        throw invalidMerge(`Card c${id} is archived or already merged and cannot be part of a merge`)
      }
      return row
    })
    return { ids, target: rows[0], sources: rows.slice(1) }
  }

  /** Decides for every link of the sources what happens to it: re-pointed to the target, or dropped (duplicate or self-link). */
  function planLinks(targetId: number, sourceIds: number[]) {
    const marks = sourceIds.map(() => '?').join(',')
    const touching = db
      .prepare(`SELECT * FROM card_links WHERE source_id IN (${marks}) OR target_id IN (${marks}) ORDER BY id`)
      .all(...sourceIds, ...sourceIds)
    const sources = new Set(sourceIds)
    // Links that stay as they are and could collide with a re-pointed link: the target's own links.
    const taken = new Set<string>()
    for (const l of db.prepare('SELECT * FROM card_links WHERE source_id = ? OR target_id = ?').all(targetId, targetId)) {
      if (!sources.has(l.source_id as number) && !sources.has(l.target_id as number)) {
        taken.add(linkKey(l.kind as string, l.source_id as number, l.target_id as number))
      }
    }
    const moved: PlannedLink[] = []
    const dropped: SnapshotLink[] = []
    for (const row of touching) {
      const base = {
        id: row.id as number,
        sourceId: row.source_id as number,
        targetId: row.target_id as number,
        kind: row.kind as LinkKind,
        label: row.label as string | null,
        createdAt: row.created_at as string,
      }
      const newSourceId = sources.has(base.sourceId) ? targetId : base.sourceId
      const newTargetId = sources.has(base.targetId) ? targetId : base.targetId
      const key = linkKey(base.kind, newSourceId, newTargetId)
      if (newSourceId === newTargetId || taken.has(key)) {
        dropped.push({ ...base, moved: false })
      } else {
        taken.add(key)
        moved.push({ link: { ...base, moved: true }, newSourceId, newTargetId })
      }
    }
    return { moved, dropped, all: [...moved.map((m) => m.link), ...dropped] }
  }

  return {
    /** Proposed merged text: the target's body, then every source under a `## <title>` heading. */
    preview(targetId: number, sourceIds: number[]): MergePreview {
      const { ids, target, sources } = validate(targetId, sourceIds)
      const body = [target.body as string, ...sources.map((s) => `## ${s.title as string}\n\n${s.body as string}`)]
        .map((part) => part.trimEnd())
        .filter((part) => part !== '')
        .join('\n\n')
      return { title: target.title as string, body, linkCount: planLinks(targetId, ids).moved.length }
    },

    /** Merges the sources into the target in one transaction; returns the new target and one merge record per source. */
    merge(input: { targetId: number; sourceIds: number[]; title: string; body: string }): { target: Card; merges: Merge[] } {
      return transaction(db, () => {
        const { ids, target, sources } = validate(input.targetId, input.sourceIds)
        const plan = planLinks(input.targetId, ids)
        const version = (target.version as number) + 1
        const included = [target, ...sources].some((c) => c.default_included === 1) ? 1 : 0

        db.prepare(
          `UPDATE cards SET title = ?, body = ?, version = ?, default_included = ?, updated_at = ${NOW} WHERE id = ?`,
        ).run(input.title, input.body, version, included, input.targetId)
        db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, ?, ?, ?)').run(
          input.targetId,
          version,
          input.title,
          input.body,
        )

        for (const l of plan.dropped) db.prepare('DELETE FROM card_links WHERE id = ?').run(l.id)
        for (const m of plan.moved) {
          db.prepare('UPDATE card_links SET source_id = ?, target_id = ? WHERE id = ?').run(m.newSourceId, m.newTargetId, m.link.id)
        }

        const merges = sources.map((source) => {
          const sourceId = source.id as number
          const links = plan.all.filter((l) => l.sourceId === sourceId || l.targetId === sourceId)
          const result = db
            .prepare(
              `INSERT INTO card_merges (target_id, source_id, source_title, source_body, source_links, target_version_before)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(input.targetId, sourceId, source.title as string, source.body as string, JSON.stringify(links), target.version as number)
          db.prepare(`UPDATE cards SET merged_into_id = ?, archived_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(
            input.targetId,
            sourceId,
          )
          return toMerge(db.prepare('SELECT * FROM card_merges WHERE id = ?').get(Number(result.lastInsertRowid))!)
        })
        return { target: cards.get(input.targetId), merges }
      })
    },

    /**
     * Undoes a whole merge operation: every merge row written by the same `POST /merges` call (same target and
     * `target_version_before`) is undone together. The sources come back with their links and the target gets the
     * text of `target_version_before` again, as a new version. Refused if the target was edited after the merge.
     */
    undo(mergeId: number): { target: Card; restored: Card[] } {
      return transaction(db, () => {
        const merge = db.prepare('SELECT * FROM card_merges WHERE id = ?').get(mergeId)
        if (!merge) throw new AppError(404, 'merge_not_found', `Merge ${mergeId} not found`)
        if (merge.undone_at !== null) throw new AppError(409, 'merge_already_undone', `Merge ${mergeId} was already undone`)
        const targetId = merge.target_id as number
        const before = merge.target_version_before as number
        const group = db
          .prepare('SELECT * FROM card_merges WHERE target_id = ? AND target_version_before = ? AND undone_at IS NULL ORDER BY id')
          .all(targetId, before)
        const target = db.prepare('SELECT * FROM cards WHERE id = ?').get(targetId)
        if (!target) throw new AppError(404, 'card_not_found', `Card c${targetId} not found`)
        if (target.archived_at !== null) {
          throw new AppError(409, 'card_archived', `Card c${targetId} is archived or merged away; undo that first`)
        }
        if (target.version !== before + 1) {
          throw new AppError(409, 'merge_outdated', `Card c${targetId} changed after the merge; undo is no longer possible`, {
            currentVersion: target.version,
            expectedVersion: before + 1,
          })
        }

        // 1. Bring the sources back with the text they had when they were merged away.
        for (const m of group) {
          const sourceId = m.source_id as number
          const source = db.prepare('SELECT * FROM cards WHERE id = ?').get(sourceId)
          if (!source) throw new AppError(404, 'card_not_found', `Card c${sourceId} not found`)
          const title = m.source_title as string
          const body = m.source_body as string
          const changed = source.title !== title || source.body !== body
          const version = (source.version as number) + (changed ? 1 : 0)
          db.prepare(
            `UPDATE cards SET title = ?, body = ?, version = ?, merged_into_id = NULL, archived_at = NULL, updated_at = ${NOW} WHERE id = ?`,
          ).run(title, body, version, sourceId)
          if (changed) {
            db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, ?, ?, ?)').run(sourceId, version, title, body)
          }
        }

        // 2. Links: back to their original ends (a link between two sources appears in both snapshots, handled once).
        const seen = new Set<number>()
        for (const m of group) {
          for (const l of JSON.parse(m.source_links as string) as SnapshotLink[]) {
            if (seen.has(l.id)) continue
            seen.add(l.id)
            const ends = [l.sourceId, l.targetId].map((id) => db.prepare('SELECT archived_at FROM cards WHERE id = ?').get(id))
            const current = db.prepare('SELECT id FROM card_links WHERE id = ?').get(l.id)
            const equivalent = db
              .prepare(
                `SELECT id FROM card_links WHERE id <> ? AND kind = ? AND
                 ((source_id = ? AND target_id = ?) OR (? = 'related' AND source_id = ? AND target_id = ?))`,
              )
              .get(l.id, l.kind, l.sourceId, l.targetId, l.kind, l.targetId, l.sourceId)
            const restorable = ends.every((e) => e !== undefined && e.archived_at === null) && equivalent === undefined
            if (!restorable) {
              if (current) db.prepare('DELETE FROM card_links WHERE id = ?').run(l.id)
            } else if (current) {
              db.prepare('UPDATE card_links SET source_id = ?, target_id = ? WHERE id = ?').run(l.sourceId, l.targetId, l.id)
            } else {
              db.prepare('INSERT INTO card_links (id, source_id, target_id, kind, label, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
                l.id,
                l.sourceId,
                l.targetId,
                l.kind,
                l.label,
                l.createdAt,
              )
            }
          }
        }

        // 3. The target gets the text of `target_version_before` again, as a new version (history stays complete).
        const old = db
          .prepare('SELECT title, body FROM card_versions WHERE card_id = ? AND version = ?')
          .get(targetId, before)
        if (!old) throw new Error(`Version ${before} of card c${targetId} is missing`)
        const version = before + 2
        db.prepare(`UPDATE cards SET title = ?, body = ?, version = ?, updated_at = ${NOW} WHERE id = ?`).run(
          old.title as string,
          old.body as string,
          version,
          targetId,
        )
        db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, ?, ?, ?)').run(
          targetId,
          version,
          old.title as string,
          old.body as string,
        )

        for (const m of group) db.prepare(`UPDATE card_merges SET undone_at = ${NOW} WHERE id = ?`).run(m.id as number)
        return { target: cards.get(targetId), restored: group.map((m) => cards.get(m.source_id as number)) }
      })
    },
  }
}
