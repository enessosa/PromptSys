import type { CardState, ContextChanges, ContextItem } from '../../api/types.ts'

export type CardEdit = { title?: string; body?: string }

/**
 * Turns the context the user edited in the replay setup into the request body:
 * `cards` lists only what differs from the original context (state changes and added cards),
 * `editedCards` the text changes (each one becomes a forked card in the new branch).
 */
export function buildContextChanges(base: ContextItem[], current: ContextItem[], edits: Record<number, CardEdit>): ContextChanges {
  const before = new Map(base.map((i) => [i.cardId, i.state]))
  const cards = current.filter((i) => before.get(i.cardId) !== i.state)
  const editedCards = Object.entries(edits)
    .filter(([, e]) => e.title !== undefined || e.body !== undefined)
    .map(([id, e]) => ({ cardId: Number(id), ...(e.title !== undefined ? { title: e.title } : {}), ...(e.body !== undefined ? { body: e.body } : {}) }))
  return { cards, editedCards }
}

/** Short human summary of the changes, e.g. "1 state change, 1 added, 1 edited". */
export function describeChanges(base: ContextItem[], changes: ContextChanges): string {
  const known = new Set(base.map((i) => i.cardId))
  const added = changes.cards.filter((c) => !known.has(c.cardId)).length
  const states = changes.cards.length - added
  const parts = [
    states > 0 ? `${states} state change${states === 1 ? '' : 's'}` : '',
    added > 0 ? `${added} added` : '',
    changes.editedCards.length > 0 ? `${changes.editedCards.length} edited` : '',
  ].filter(Boolean)
  return parts.length === 0 ? 'no context changes' : parts.join(', ')
}

export const CARD_STATES: CardState[] = ['included', 'pinned', 'excluded']
