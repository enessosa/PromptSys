import { describe, expect, it } from 'vitest'
import {
  analyzeCitations,
  findMarkers,
  StreamingCitationParser,
  type CardLookup,
  type ParserEvent,
} from './index.ts'

/** Feeds chunks to a parser; returns the released text pieces (per push) and the markers. */
function run(chunks: string[]) {
  const parser = new StreamingCitationParser()
  const pushes: ParserEvent[][] = chunks.map((c) => parser.push(c))
  const tail = parser.flush()
  const events = [...pushes.flat(), ...tail]
  const text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
  const markers = events.flatMap((e) => (e.type === 'marker' ? [e] : []))
  return { pushes, tail, text, markers }
}

describe('StreamingCitationParser', () => {
  it('passes plain text through unchanged', () => {
    const r = run(['Hello ', 'world'])
    expect(r.text).toBe('Hello world')
    expect(r.markers).toEqual([])
  })

  it('finds a marker in one chunk and keeps its text', () => {
    const r = run(['Fields are required [c3].'])
    expect(r.text).toBe('Fields are required [c3].')
    expect(r.markers).toEqual([{ type: 'marker', rawId: 3, marker: '[c3]', start: 20, end: 24 }])
  })

  it('emits the marker after the text that contains it', () => {
    const r = run(['a[c1]b'])
    expect(r.pushes[0]).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: '[c1]' },
      { type: 'marker', rawId: 1, marker: '[c1]', start: 1, end: 5 },
      { type: 'text', text: 'b' },
    ])
  })

  it('holds back a marker split across chunks and releases it one chunk later', () => {
    const r = run(['see [c', '3] ok'])
    expect(r.pushes[0]).toEqual([{ type: 'text', text: 'see ' }])
    expect(r.pushes[1]).toEqual([
      { type: 'text', text: '[c3]' },
      { type: 'marker', rawId: 3, marker: '[c3]', start: 4, end: 8 },
      { type: 'text', text: ' ok' },
    ])
    expect(r.text).toBe('see [c3] ok')
  })

  it('handles every split position, also character by character', () => {
    const full = 'x [c12] y [c3][c45] z'
    const expected = findMarkers(full)
    for (let cut = 0; cut <= full.length; cut++) {
      const r = run([full.slice(0, cut), full.slice(cut)])
      expect(r.text).toBe(full)
      expect(r.markers.map(({ rawId, marker, start, end }) => ({ rawId, marker, start, end }))).toEqual(expected)
    }
    const r = run([...full])
    expect(r.text).toBe(full)
    expect(r.markers).toHaveLength(3)
  })

  it('releases text when the pattern breaks', () => {
    const r = run(['[', 'x'])
    expect(r.pushes[0]).toEqual([])
    expect(r.pushes[1]).toEqual([{ type: 'text', text: '[x' }])
    expect(run(['[c', 'a]']).text).toBe('[ca]')
  })

  it('leaves wrong shapes as plain text', () => {
    for (const text of ['[c3, c5]', '[C3]', '[3]', '[c]', '[c3', '[ c3]', '[c3 ]']) {
      const r = run([text])
      expect(r.text).toBe(text)
      expect(r.markers).toEqual([])
    }
  })

  it('flushes an unfinished marker at the end as plain text', () => {
    const r = run(['done [c', '12'])
    expect(r.pushes[1]).toEqual([])
    expect(r.tail).toEqual([{ type: 'text', text: '[c12' }])
    expect(r.text).toBe('done [c12')
    expect(r.markers).toEqual([])
  })

  it('releases after 12 characters without a closing bracket', () => {
    const r = run(['[c12345678', '90', 'x'])
    expect(r.text).toBe('[c1234567890x')
    expect(r.markers).toEqual([])
    expect(r.pushes[0]).toEqual([]) // still a possible prefix
    expect(r.pushes[1].length).toBeGreaterThan(0) // released at 12 characters
  })

  it('recognizes the longest marker (9 digits)', () => {
    const r = run(['[c123456789', ']'])
    expect(r.markers).toMatchObject([{ rawId: 123456789, start: 0, end: 12 }])
  })

  it('counts repeated markers separately and recognizes ones inside code blocks', () => {
    const r = run(['```\n[c1]\n``` and [c1] again [c1]'])
    expect(r.markers.map((m) => m.rawId)).toEqual([1, 1, 1])
  })

  it('counts offsets in UTF-16 code units', () => {
    const r = run(['😀 ä [c7]'])
    expect(r.markers[0]).toMatchObject({ start: 5, end: 9 }) // the emoji is 2 code units
    expect(findMarkers('😀 ä [c7]')[0]).toMatchObject({ start: 5, end: 9 })
  })

  it('agrees with the final re-parse', () => {
    const full = 'A [c1] B [c2][c1] C [c99] [c3, c4] [c'
    const r = run([full.slice(0, 7), full.slice(7, 16), full.slice(16)])
    expect(r.text).toBe(full)
    expect(r.markers.map(({ rawId, marker, start, end }) => ({ rawId, marker, start, end }))).toEqual(findMarkers(full))
  })
})

describe('analyzeCitations', () => {
  const lookup = (inPrompt: number[], merged: Record<number, number | null>): CardLookup => ({
    inPrompt: new Set(inPrompt),
    mergedInto: (id) => (id in merged ? merged[id] : undefined),
  })

  it('marks cards of the prompt valid and lists used and unused cards', () => {
    const l = lookup([1, 2, 3], { 1: null, 2: null, 3: null })
    const s = analyzeCitations('a [c1] b [c1] c [c3]', l, [1, 2, 3])
    expect(s.citations.map((c) => [c.cardId, c.valid])).toEqual([[1, true], [1, true], [3, true]])
    expect(s.usedCardIds).toEqual([1, 3])
    expect(s.unusedCardIds).toEqual([2])
    expect(s.invalidMarkers).toEqual([])
  })

  it('marks unknown cards invalid with a null card', () => {
    const s = analyzeCitations('x [c42] y [c42]', lookup([1], { 1: null }), [1])
    expect(s.citations.map((c) => [c.cardId, c.valid])).toEqual([[null, false], [null, false]])
    expect(s.usedCardIds).toEqual([])
    expect(s.unusedCardIds).toEqual([1])
    expect(s.invalidMarkers).toEqual(['[c42]'])
  })

  it('marks existing cards that are not in the prompt (excluded) invalid but keeps the card id', () => {
    const s = analyzeCitations('x [c5]', lookup([1], { 1: null, 5: null }), [1])
    expect(s.citations).toMatchObject([{ cardId: 5, valid: false, start: 2, end: 6 }])
    expect(s.usedCardIds).toEqual([])
    expect(s.invalidMarkers).toEqual(['[c5]'])
  })

  it('resolves merged-away cards to their target', () => {
    const l = lookup([7], { 3: 5, 5: 7, 7: null })
    const s = analyzeCitations('a [c3]', l, [7])
    expect(s.citations).toMatchObject([{ rawId: 3, cardId: 7, valid: true }])
    expect(s.usedCardIds).toEqual([7])
  })

  it('treats a merged target outside the prompt as invalid', () => {
    const l = lookup([1], { 3: 5, 5: null, 1: null })
    const s = analyzeCitations('a [c3]', l, [1])
    expect(s.citations).toMatchObject([{ cardId: 5, valid: false }])
  })

  it('prefers a card that is itself in the prompt over its merge target', () => {
    const l = lookup([3], { 3: 5, 5: null })
    expect(analyzeCitations('[c3]', l, [3]).citations).toMatchObject([{ cardId: 3, valid: true }])
  })

  it('survives circular merge data', () => {
    const l = lookup([1], { 8: 9, 9: 8, 1: null })
    expect(analyzeCitations('[c8]', l, [1]).citations).toMatchObject([{ valid: false }])
  })

  it('ignores wrong shapes', () => {
    const s = analyzeCitations('[c3, c5] [C3] [3]', lookup([3], { 3: null }), [3])
    expect(s.citations).toEqual([])
    expect(s.unusedCardIds).toEqual([3])
  })
})
