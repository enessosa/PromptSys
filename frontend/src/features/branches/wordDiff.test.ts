import { describe, expect, it } from 'vitest'
import { diffWords, sideSegments } from './wordDiff.ts'

describe('diffWords', () => {
  it('returns one unchanged segment for equal texts', () => {
    expect(diffWords('same text', 'same text')).toEqual([{ text: 'same text', kind: 'same' }])
  })

  it('marks replaced words: removed before added', () => {
    expect(diffWords('the field is required', 'the field is optional')).toEqual([
      { text: 'the field is ', kind: 'same' },
      { text: 'required', kind: 'removed' },
      { text: 'optional', kind: 'added' },
    ])
  })

  it('finds an inserted word in the middle', () => {
    const d = diffWords('a b c', 'a b x c')
    expect(d.filter((s) => s.kind === 'added').map((s) => s.text.trim())).toEqual(['x'])
    expect(d.some((s) => s.kind === 'removed')).toBe(false)
  })

  it('keeps both sides reconstructible', () => {
    const a = 'Use rule one and rule two for every request.'
    const b = 'Use rule two and a new rule three for requests.'
    const d = diffWords(a, b)
    expect(sideSegments(d, 'left').map((s) => s.text).join('')).toBe(a)
    expect(sideSegments(d, 'right').map((s) => s.text).join('')).toBe(b)
  })

  it('handles empty input', () => {
    expect(diffWords('', 'new')).toEqual([{ text: 'new', kind: 'added' }])
    expect(diffWords('old', '')).toEqual([{ text: 'old', kind: 'removed' }])
    expect(diffWords('', '')).toEqual([])
  })
})
