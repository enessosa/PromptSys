import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../common/errors.ts'
import type { DerivedRule, RuleStatus } from './schema.ts'

type Row = Record<string, unknown>

export type NewRule = { text: string; sourceKind: 'card' | 'prior_knowledge'; sourceCardId: number | null }

const toRule = (row: Row): DerivedRule => ({
  id: row.id as number,
  conversationId: row.conversation_id as number,
  messageId: row.message_id as number,
  text: row.text as string,
  status: row.status as RuleStatus,
  source: { kind: row.source_kind as 'card' | 'prior_knowledge', cardId: row.source_card_id as number | null, reliability: 'claimed' },
  cardId: row.corrected_card_id as number | null,
  createdAt: row.created_at as string,
})

const TITLE_LENGTH = 60

/** Card title from the rule text: first line, shortened. */
export function titleOf(text: string): string {
  const line = text.trim().split('\n')[0].trim()
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
}

export function createRulesRepository(db: DatabaseSync) {
  function get(id: number): DerivedRule {
    const row = db.prepare('SELECT * FROM derived_rules WHERE id = ?').get(id)
    if (!row) throw new AppError(404, 'not_found', `Rule ${id} not found`)
    return toRule(row)
  }

  const forConversation = (conversationId: number, includeRejected: boolean): DerivedRule[] =>
    db
      .prepare(`SELECT * FROM derived_rules WHERE conversation_id = ? ${includeRejected ? '' : "AND status <> 'rejected'"} ORDER BY id`)
      .all(conversationId)
      .map(toRule)

  /** Replaces the still undecided rules of this answer with a new proposal (decided ones are kept). Run inside a transaction. */
  function replaceProposed(conversationId: number, messageId: number, rules: NewRule[]): DerivedRule[] {
    db.prepare("DELETE FROM derived_rules WHERE message_id = ? AND status = 'proposed'").run(messageId)
    const insert = db.prepare('INSERT INTO derived_rules (conversation_id, message_id, text, source_kind, source_card_id) VALUES (?, ?, ?, ?, ?)')
    return rules.map((r) => get(Number(insert.run(conversationId, messageId, r.text, r.sourceKind, r.sourceCardId).lastInsertRowid)))
  }

  function setStatus(id: number, status: RuleStatus): DerivedRule {
    db.prepare('UPDATE derived_rules SET status = ? WHERE id = ?').run(status, id)
    return get(id)
  }

  /**
   * Creates a rule card (kind `rule`, included by default) holding `text`, links it to the source card of the rule
   * (`derived_from`, only if that card is still alive) and stores it as the rule's card. Run inside a transaction.
   */
  function createRuleCard(rule: DerivedRule, text: string, status: RuleStatus): { rule: DerivedRule; cardId: number } {
    const title = titleOf(text)
    const cardId = Number(
      db.prepare("INSERT INTO cards (title, body, kind, default_included) VALUES (?, ?, 'rule', 1)").run(title, text).lastInsertRowid,
    )
    db.prepare('INSERT INTO card_versions (card_id, version, title, body) VALUES (?, 1, ?, ?)').run(cardId, title, text)
    const sourceId = rule.source.cardId
    if (sourceId !== null) {
      const alive = db.prepare('SELECT 1 FROM cards WHERE id = ? AND archived_at IS NULL AND merged_into_id IS NULL').get(sourceId)
      if (alive) db.prepare("INSERT INTO card_links (source_id, target_id, kind) VALUES (?, ?, 'derived_from')").run(cardId, sourceId)
    }
    db.prepare('UPDATE derived_rules SET status = ?, corrected_card_id = ? WHERE id = ?').run(status, cardId, rule.id)
    return { rule: get(rule.id), cardId }
  }

  return { get, forConversation, replaceProposed, setStatus, createRuleCard }
}

export type RulesRepository = ReturnType<typeof createRulesRepository>
