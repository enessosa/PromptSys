import { describe, expect, it } from 'vitest'
import { changeOf, cosine, NOISE_MARGIN, scoreCard, STRONG_EFFECT } from './score.ts'

describe('cosine', () => {
  it('is 1 for equal, 0 for orthogonal, -1 for opposite vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
  })
  it('ignores length and handles zero vectors and mismatched sizes', () => {
    expect(cosine([2, 0], [5, 0])).toBeCloseTo(1)
    expect(cosine([0, 0], [1, 1])).toBe(0)
    expect(() => cosine([1], [1, 2])).toThrow()
  })
})

describe('changeOf', () => {
  it('is 1 minus the mean similarity, null without runs', () => {
    expect(changeOf([0.9, 0.7])).toBeCloseTo(0.2)
    expect(changeOf([])).toBeNull()
  })
})

describe('scoreCard', () => {
  it('returns null without ablated runs', () => {
    expect(scoreCard([], [0.9])).toBeNull()
  })
  it('subtracts the noise and never goes below 0', () => {
    expect(scoreCard([0.6], [0.9])).toMatchObject({ change: 0.4, effect: expect.closeTo(0.3), noise: expect.closeTo(0.1) })
    expect(scoreCard([0.95], [0.8])?.effect).toBe(0)
  })
  it('labels within noise, weak and strong', () => {
    const noisy = [0.9] // noise 0.1
    expect(scoreCard([0.9 - NOISE_MARGIN / 2], noisy)?.label).toBe('within_noise')
    expect(scoreCard([0.9 - NOISE_MARGIN - 0.01 - 0.0], noisy)?.label).toBe('weak')
    expect(scoreCard([0.9 - STRONG_EFFECT - 0.01], noisy)?.label).toBe('strong')
  })
  it('works without baseline: noise 0, flagged as not measured', () => {
    expect(scoreCard([0.5], [])).toMatchObject({ noise: 0, noiseMeasured: false, effect: 0.5, label: 'strong' })
    expect(scoreCard([0.99], [])?.label).toBe('within_noise')
  })
})
