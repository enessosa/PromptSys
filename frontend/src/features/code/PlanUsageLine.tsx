import { useEffect, useState } from 'react'
import type { PlanUsage, PlanWindow } from '../../api/types.ts'
import { usePlanUsage } from './hooks.ts'
import { resetIn } from './model.ts'
import styles from './code.module.css'

const pct = (w: PlanWindow) => `${Math.round(w.utilization)}%`
const row = (label: string, w?: PlanWindow) => (w ? `${label}: ${pct(w)} used${w.resetsAt ? `, resets ${new Date(w.resetsAt).toLocaleString()}` : ''}` : null)

function title(plan: PlanUsage): string {
  return [plan.subscriptionType ? `Plan: ${plan.subscriptionType}` : null, row('5-hour window', plan.fiveHour), row('7-day window', plan.sevenDay), `As of ${new Date(plan.observedAt).toLocaleString()} (updated after each turn)`]
    .filter(Boolean)
    .join('\n')
}

/** The current time, updated every 30 seconds (for the countdowns). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function Window({ label, w, now }: { label: string; w: PlanWindow; now: number }) {
  const left = resetIn(w.resetsAt, now)
  return (
    <span className={styles.planWindow}>
      {` · ${label} ${pct(w)}`}
      {left && <span className={styles.planReset}>{left === 'now' ? ' (reset, new value after the next turn)' : ` (resets in ${left})`}</span>}
    </span>
  )
}

/** Account-wide plan limits, once for all sessions (they would contradict each other per session). Hidden until a turn reported them. */
export function PlanUsageLine() {
  const { data } = usePlanUsage()
  const now = useNow()
  if (!data || (!data.fiveHour && !data.sevenDay)) return null
  return (
    <p className={styles.planUsage} data-testid="plan-usage" title={title(data)}>
      Plan limits
      {data.fiveHour && <Window label="5h" w={data.fiveHour} now={now} />}
      {data.sevenDay && <Window label="7d" w={data.sevenDay} now={now} />}
    </p>
  )
}
