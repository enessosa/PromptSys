import type { AppMode } from '../../api/types.ts'
import { useMode, useSetMode } from './hooks.ts'
import styles from './code.module.css'

const OPTIONS: { value: AppMode; label: string }[] = [
  { value: 'api', label: 'API' },
  { value: 'claude_code', label: 'Agent' },
]

/** Segmented control for the working mode (sidebar header and settings). */
export function ModeSwitch() {
  const { mode } = useMode()
  const { setMode, isPending, isError, error } = useSetMode()
  return (
    <div className={styles.modeWrap}>
      <div className={styles.mode} role="radiogroup" aria-label="Mode">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            data-active={mode === o.value || undefined}
            disabled={isPending}
            onClick={() => mode !== o.value && setMode(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {isError && <span role="alert" className={styles.modeError}>{error.message}</span>}
    </div>
  )
}
