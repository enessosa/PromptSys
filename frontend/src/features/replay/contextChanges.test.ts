import { describe, expect, it } from 'vitest'
import { buildContextChanges, describeChanges } from './contextChanges.ts'

const base = [
  { cardId: 1, state: 'included' as const },
  { cardId: 2, state: 'included' as const },
]

describe('buildContextChanges', () => {
  it('is empty without changes', () => {
    expect(buildContextChanges(base, base, {})).toEqual({ cards: [], editedCards: [] })
  })

  it('lists changed states and added cards only', () => {
    const current = [{ cardId: 1, state: 'pinned' as const }, base[1], { cardId: 5, state: 'included' as const }]
    const changes = buildContextChanges(base, current, {})
    expect(changes.cards).toEqual([{ cardId: 1, state: 'pinned' }, { cardId: 5, state: 'included' }])
    expect(describeChanges(base, changes)).toBe('1 state change, 1 added')
  })

  it('lists edits with only the changed fields', () => {
    const changes = buildContextChanges(base, base, { 2: { body: 'new text' }, 1: {} })
    expect(changes.editedCards).toEqual([{ cardId: 2, body: 'new text' }])
    expect(describeChanges(base, changes)).toBe('1 edited')
  })
})
