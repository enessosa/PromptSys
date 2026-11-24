import type { PlanUsage, PlanWindow } from '../../api/types.ts'
import { usePlanUsage } from './hooks.ts'
import styles from './code.module.css'

const pct = (w: PlanWindow) => `${Math.round(w.utilization)}%`
const row = (label: string, w?: PlanWindow) => (w ? `${label}: ${pct(w)} used${w.resetsAt ? `, resets ${new Date(w.resetsAt).toLocaleString()}` : ''}` : null)

function title(plan: PlanUsage): string {
  return [plan.subscriptionType ? `Plan: ${plan.subscriptionType}` : null, row('5-hour window', plan.fiveHour), row('7-day window', plan.sevenDay), `As of ${new Date(plan.observedAt).toLocaleString()} (updated after each turn)`]
    .filter(Boolean)
    .join('\n')
}

/** Account-wide plan limits, once for all sessions (they would contradict each other per session). Hidden until a turn reported them. */
export function PlanUsageLine() {
  const { data } = usePlanUsage()
  if (!data || (!data.fiveHour && !data.sevenDay)) return null
  return (
    <p className={styles.planUsage} data-testid="plan-usage" title={title(data)}>
      Plan limits{data.fiveHour && ` · 5h ${pct(data.fiveHour)}`}
      {data.sevenDay && ` · 7d ${pct(data.sevenDay)}`}
    </p>
  )
}
