import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './ui.module.css'

export type MenuItem =
  | { separator: true }
  | { label: string; onSelect: () => void; danger?: boolean; separator?: false }

type Props = { x: number; y: number; items: MenuItem[]; onClose: () => void }

/** Menu at a screen position (right click); closes on selection, Escape or any outside click. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={styles.menu}
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - items.length * 32 - 16) }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className={styles.menuSep} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={styles.menuItem}
            data-danger={item.danger ? 'true' : undefined}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
