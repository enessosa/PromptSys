import { ApiError } from '../../api/client.ts'
import type { AblationCardResult, AblationDryRun, AblationLabel } from '../../api/types.ts'

export const LABEL_TEXT: Record<AblationLabel, string> = {
  strong: 'strong',
  weak: 'weak',
  within_noise: 'within noise',
}

export const labelText = (label: AblationLabel) => LABEL_TEXT[label]

/** Width of the effect bar in percent (effect is 0..1). */
export const barPercent = (effect: number) => Math.round(Math.min(1, Math.max(0, effect)) * 100)

/** Short badge for a citation chip, e.g. "strong 0.42". */
export const badgeText = (r: Pick<AblationCardResult, 'label' | 'effect'>) => `${labelText(r.label)} ${r.effect.toFixed(2)}`

/**
 * FR-11: spread of the change over the runs, as population standard deviation of (1 - similarity).
 * Null with fewer than two runs, where a spread cannot be measured.
 */
export function changeSpread(answers: { similarity: number }[]): number | null {
  if (answers.length < 2) return null
  const changes = answers.map((a) => 1 - a.similarity)
  const mean = changes.reduce((sum, c) => sum + c, 0) / changes.length
  return Math.sqrt(changes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / changes.length)
}

/** Spread next to the effect, e.g. "±0.03"; null when there is no spread to show. */
export function spreadText(answers: { similarity: number }[]): string | null {
  const spread = changeSpread(answers)
  return spread === null ? null : `±${spread.toFixed(2)}`
}

/** FR-21: "3 + 3 × 2 = 9 API calls"; baseline runs that are reused are not counted. */
export function callsFormula(d: AblationDryRun): string {
  const baseline = Math.max(0, d.baselineRuns - d.reusedBaselineRuns)
  const calls = `${d.estimatedApiCalls} API call${d.estimatedApiCalls === 1 ? '' : 's'}`
  const reused = d.reusedBaselineRuns > 0 ? ` (${d.reusedBaselineRuns} baseline run${d.reusedBaselineRuns === 1 ? '' : 's'} reused)` : ''
  return `${baseline} + ${d.runs} × ${d.cardIds.length} = ${calls}${reused}`
}

/** Readable text for the errors the ablation endpoints can answer with. */
export function ablationErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'api_key_missing' || error.status === 424) return 'No API key configured. Set ANTHROPIC_API_KEY in backend/.env and restart the backend.'
    if (error.code === 'generation_running' || error.status === 409) return 'An ablation or answer is already running for this message. Wait until it has finished.'
    if (error.status === 400) return `Cannot run this ablation: ${error.message}`
    return error.message
  }
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const { code, message } = error as { code: string; message: string }
    if (code === 'llm_rate_limited') return 'The API rate limit was reached. Results so far are kept.'
    if (code === 'llm_timeout') return 'The model took too long to answer. Results so far are kept.'
    return String(message)
  }
  return error instanceof Error ? error.message : 'The ablation failed.'
}
