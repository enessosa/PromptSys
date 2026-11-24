import { describe, expect, it } from 'vitest'
import { applyAccent, isHexColor, mutedAccent } from './accent.ts'

describe('accent colour', () => {
  it('derives the muted surface colour', () => {
    expect(mutedAccent('#ff8000')).toBe('rgb(255 128 0 / 0.16)')
    expect(mutedAccent('orange')).toBeNull()
    expect(isHexColor('#12abEF')).toBe(true)
    expect(isHexColor('#12abE')).toBe(false)
  })

  it('sets and resets the CSS variables', () => {
    const el = document.createElement('div')
    applyAccent('#336699', el)
    expect(el.style.getPropertyValue('--ps-accent')).toBe('#336699')
    expect(el.style.getPropertyValue('--ps-accent-muted')).toBe('rgb(51 102 153 / 0.16)')
    applyAccent(null, el)
    expect(el.style.getPropertyValue('--ps-accent')).toBe('')
  })

  it('ignores an invalid colour', () => {
    const el = document.createElement('div')
    applyAccent('not-a-colour', el)
    expect(el.style.getPropertyValue('--ps-accent')).toBe('')
  })
})
