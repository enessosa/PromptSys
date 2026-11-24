import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './ui.module.css'

export const HOVER_DELAY_MS = 400

type Props = {
  /** Rendered inside the floating card; it is only mounted while the card is open. */
  content: ReactNode
  children: ReactNode
  delay?: number
  className?: string
}

/** Wraps `children` and shows `content` in a floating card after the pointer rested on it for `delay` ms. */
export function HoverCard({ content, children, delay = HOVER_DELAY_MS, className }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const open = (el: HTMLElement) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect()
      const x = Math.min(r.right + 8, window.innerWidth - 336)
      const y = Math.min(r.top, window.innerHeight - 260)
      setPos({ x: Math.max(8, x), y: Math.max(8, y) })
    }, delay)
  }
  const close = () => {
    window.clearTimeout(timer.current)
    setPos(null)
  }

  return (
    <span
      className={className}
      style={{ display: 'contents' }}
      onPointerEnter={(e) => open((e.currentTarget.firstElementChild ?? e.currentTarget) as HTMLElement)}
      onPointerLeave={close}
      onPointerDown={close}
    >
      {children}
      {pos &&
        createPortal(
          <div className={styles.hoverCard} style={{ left: pos.x, top: pos.y }} role="tooltip">
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}
