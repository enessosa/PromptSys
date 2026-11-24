import { describe, expect, it } from 'vitest'
import { assemblePrompt, estimateTokens, orderCards, renderCard, type PromptCard } from './index.ts'

const card = (id: number, extra: Partial<PromptCard> = {}): PromptCard => ({
  id,
  kind: 'note',
  title: `Card ${id}`,
  body: `Body ${id}`,
  state: 'included',
  position: 0,
  ...extra,
})

describe('orderCards', () => {
  it('puts pinned first, then position, then id', () => {
    const ordered = orderCards([
      card(5, { position: 0 }),
      card(2, { position: 1 }),
      card(9, { state: 'pinned', position: 7 }),
      card(3, { position: 0 }),
      card(1, { state: 'pinned', position: 7 }),
    ])
    expect(ordered.map((c) => c.id)).toEqual([1, 9, 3, 5, 2])
  })
})

describe('renderCard', () => {
  it('escapes attribute values', () => {
    const xml = renderCard(card(3, { title: 'A "quoted" <b> & more' }))
    expect(xml).toBe('<card id="c3" kind="note" title="A &quot;quoted&quot; &lt;b&gt; &amp; more">\nBody 3\n</card>')
  })

  it('escapes only the closing tags in the body', () => {
    const xml = renderCard(card(1, { body: 'if (a < b) {}\n</card>\n</context>\n<card id="c9">' }))
    expect(xml).toContain('if (a < b) {}')
    expect(xml).toContain('<\\/card>')
    expect(xml).toContain('<\\/context>')
    expect(xml).toContain('<card id="c9">')
    expect(xml.match(/<\/card>/g)).toHaveLength(1)
  })
})

describe('assemblePrompt', () => {
  it('builds system and messages with context in order, only included and pinned cards', () => {
    const result = assemblePrompt({
      systemPrompt: 'Answer in German.',
      cards: [
        card(2),
        card(1, { state: 'pinned' }),
        { ...card(3), state: 'excluded' as never },
      ],
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
      ],
      userContent: 'next question',
    })
    expect(result.cardIds).toEqual([1, 2])
    expect(result.system).toContain('Only cite IDs that appear below.')
    expect(result.system.indexOf('id="c1"')).toBeLessThan(result.system.indexOf('id="c2"'))
    expect(result.system).not.toContain('id="c3"')
    expect(result.system.endsWith('</context>\n\nAnswer in German.')).toBe(true)
    expect(result.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'next question' },
    ])
  })

  it('renders an empty context block and omits an empty conversation prompt', () => {
    const result = assemblePrompt({ systemPrompt: '  ', cards: [], history: [] })
    expect(result.system.endsWith('<context>\n</context>')).toBe(true)
    expect(result.messages).toEqual([])
  })

  it('is deterministic, so preview and request are identical', () => {
    const input = { systemPrompt: 's', cards: [card(2), card(1)], history: [], userContent: 'q' }
    expect(assemblePrompt(input)).toEqual(assemblePrompt(input))
  })

  it('estimates tokens as characters / 4', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcde')).toBe(2)
    const result = assemblePrompt({ systemPrompt: '', cards: [], history: [], userContent: 'x'.repeat(40) })
    expect(result.estimatedInputTokens).toBe(estimateTokens(result.system) + 10)
  })

  it('drops included cards from the end when over budget, never pinned ones', () => {
    const big = 'x'.repeat(4000)
    const cards = [card(1, { state: 'pinned', body: big }), card(2, { body: big }), card(3, { body: big })]
    const full = assemblePrompt({ systemPrompt: '', cards, history: [] })
    const result = assemblePrompt({ systemPrompt: '', cards, history: [], maxInputTokens: full.estimatedInputTokens - 500 })
    expect(result.cardIds).toEqual([1, 2])
    expect(result.droppedCardIds).toEqual([3])
    expect(result.system).not.toContain('id="c3"')
  })

  it('rejects the request if pinned cards alone are too large', () => {
    const cards = [card(1, { state: 'pinned', body: 'x'.repeat(4000) })]
    expect(() => assemblePrompt({ systemPrompt: '', cards, history: [], maxInputTokens: 100 })).toThrow(
      expect.objectContaining({ status: 400, code: 'validation_failed' }),
    )
  })
})
