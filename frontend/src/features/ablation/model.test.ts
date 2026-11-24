import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client.ts'
import { ablationErrorText, badgeText, barPercent, callsFormula, changeSpread, labelText, spreadText } from './model.ts'

describe('ablation model', () => {
  it('names the labels for people', () => {
    expect(labelText('within_noise')).toBe('within noise')
    expect(labelText('strong')).toBe('strong')
  })

  it('clamps the bar to 0..100 percent', () => {
    expect(barPercent(0.426)).toBe(43)
    expect(barPercent(-1)).toBe(0)
    expect(barPercent(3)).toBe(100)
  })

  it('formats the badge', () => {
    expect(badgeText({ label: 'weak', effect: 0.0712 })).toBe('weak 0.07')
  })

  it('shows k + n x cards and reused baseline runs', () => {
    const d = { messageId: 1, cardIds: [1, 2], runs: 3, baselineRuns: 3, reusedBaselineRuns: 0, estimatedApiCalls: 9 }
    expect(callsFormula(d)).toBe('3 + 3 × 2 = 9 API calls')
    expect(callsFormula({ ...d, reusedBaselineRuns: 3, estimatedApiCalls: 6 })).toBe('0 + 3 × 2 = 6 API calls (3 baseline runs reused)')
  })

  it('measures the spread of the change over the runs', () => {
    // changes 0.1 and 0.2 -> population std 0.05
    expect(changeSpread([{ similarity: 0.9 }, { similarity: 0.8 }])).toBeCloseTo(0.05)
    expect(spreadText([{ similarity: 0.9 }, { similarity: 0.8 }])).toBe('±0.05')
    expect(spreadText([{ similarity: 0.7 }, { similarity: 0.7 }, { similarity: 0.7 }])).toBe('±0.00')
  })

  it('shows no spread for a single run', () => {
    expect(changeSpread([{ similarity: 0.69 }])).toBeNull()
    expect(spreadText([])).toBeNull()
  })

  it('maps 424, 409 and 400', () => {
    expect(ablationErrorText(new ApiError(424, 'api_key_missing', 'x'))).toMatch(/ANTHROPIC_API_KEY/)
    expect(ablationErrorText(new ApiError(409, 'generation_running', 'x'))).toMatch(/already running/)
    expect(ablationErrorText(new ApiError(400, 'validation_failed', 'card was not sent'))).toBe('Cannot run this ablation: card was not sent')
    expect(ablationErrorText({ code: 'llm_rate_limited', message: 'm' })).toMatch(/rate limit/)
  })
})
