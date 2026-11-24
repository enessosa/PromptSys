import type { AblationCardResult } from '../../api/types.ts'
import { barPercent, labelText } from './model.ts'
import styles from './ablation.module.css'

/** Effect of a card on the answer as a bar from 0 to 1, with the label next to it. */
export function ScoreBar({ result, spread }: { result: Pick<AblationCardResult, 'effect' | 'label'>; spread?: string | null }) {
  return (
    <div className={styles.scoreRow}>
      <div
        className={styles.bar}
        role="meter"
        aria-label="Effect"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(result.effect.toFixed(2))}
      >
        <div className={styles.barFill} data-label={result.label} style={{ width: `${barPercent(result.effect)}%` }} />
      </div>
      <span className={styles.scoreValue}>{result.effect.toFixed(2)}</span>
      {spread && <span className={styles.spread} title="Spread of the change over the runs">{spread}</span>}
      <span className={styles.label} data-label={result.label}>
        {labelText(result.label)}
      </span>
    </div>
  )
}
