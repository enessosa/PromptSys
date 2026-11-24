import { useEffect, type ReactNode } from 'react'
import styles from './ui.module.css'

/** Small status toast with an optional action (e.g. Undo); disappears after `duration` ms. */
export function Toast({ children, onClose, duration = 10000 }: { children: ReactNode; onClose: () => void; duration?: number }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(t)
  }, [onClose, duration])
  return (
    <div className={styles.toast} role="status">
      {children}
    </div>
  )
}
