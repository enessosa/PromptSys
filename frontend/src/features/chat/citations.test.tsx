import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import { markerLookup, splitMarkers } from './citations.ts'
import { AssistantText } from './MessageView.tsx'

describe('citation markers', () => {
  it('splits text into plain parts and markers', () => {
    expect(splitMarkers('A [c3] and [c12].')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'marker', marker: '[c3]', cardId: 3 },
      { type: 'text', text: ' and ' },
      { type: 'marker', marker: '[c12]', cardId: 12 },
      { type: 'text', text: '.' },
    ])
    expect(splitMarkers('no markers [x] [c] [c1')).toEqual([{ type: 'text', text: 'no markers [x] [c] [c1' }])
  })

  it('renders valid markers as accent chips and invalid ones as muted chips with a warning', () => {
    mockFetch({})
    const citations = [
      { cardId: 3, marker: '[c3]', start: 4, end: 8, valid: true },
      { cardId: 9, marker: '[c9]', start: 13, end: 17, valid: false },
    ]
    renderWithProviders(<AssistantText text="See [c3] and [c9]. `[c3]` stays code." citations={citations} />)
    expect(screen.getByRole('button', { name: 'Open [c3]' })).toHaveAttribute('data-valid', 'true')
    const invalid = screen.getByRole('button', { name: '[c9] (not in the prompt)' })
    expect(invalid).toHaveAttribute('data-valid', 'false')
    expect(invalid.querySelector('svg')).not.toBeNull()
    // the marker inside inline code is not turned into a chip
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(document.querySelector('code')?.textContent).toBe('[c3]')
    vi.unstubAllGlobals()
  })

  it('keeps the card of a merged marker (the backend resolves it) and builds the lookup', () => {
    const lookup = markerLookup([{ cardId: 7, marker: '[c2]', start: 0, end: 4, valid: true }])
    expect(lookup.get('[c2]')).toEqual({ cardId: 7, valid: true })
  })
})
