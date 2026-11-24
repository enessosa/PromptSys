// Score calculation of the similarity ablation (pure functions, see docs/phases/3. Draft.md, "Ablation").

export type AblationLabel = 'strong' | 'weak' | 'within_noise'

/** `change <= noise + NOISE_MARGIN` counts as "within noise". Provisional; tune with real runs. */
export const NOISE_MARGIN = 0.02
/** `effect >= STRONG_EFFECT` is "strong", anything between the noise margin and that is "weak". Provisional. */
export const STRONG_EFFECT = 0.1

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vectors must have the same length')
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length

/** `1 - mean(similarities)`: how far the answers moved away from the original. `null` without runs. */
export function changeOf(similarities: number[]): number | null {
  return similarities.length === 0 ? null : 1 - mean(similarities)
}

export type CardScore = {
  /** `1 - mean cosine` of the ablated answers to the original. */
  change: number
  /** Noise floor from the baseline runs; 0 if there are none (`noiseMeasured: false`). */
  noise: number
  noiseMeasured: boolean
  /** `max(0, change - noise)`. */
  effect: number
  label: AblationLabel
}

/**
 * Combines the similarities of the ablated runs of one card with those of the baseline runs.
 * Without baseline runs the noise is 0, so the label only reflects the margin; the caller tells the user.
 */
export function scoreCard(ablated: number[], baseline: number[]): CardScore | null {
  const change = changeOf(ablated)
  if (change === null) return null
  const measured = changeOf(baseline)
  const noise = measured ?? 0
  const effect = Math.max(0, change - noise)
  const label: AblationLabel = change <= noise + NOISE_MARGIN ? 'within_noise' : effect >= STRONG_EFFECT ? 'strong' : 'weak'
  return { change, noise, noiseMeasured: measured !== null, effect, label }
}

/** Shown for `within_noise`: the ablation cannot tell "not needed" from "the model already knew it". */
export const NO_EFFECT_TEXT = 'No effect: card not needed or model already knew it.'
