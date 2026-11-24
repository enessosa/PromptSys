import { useCard } from './hooks.ts'
import { cardLabel, KIND_COLORS } from './model.ts'
import styles from './cards.module.css'

/** Content of the hover preview: title and the first lines of the body. */
export function CardPreview({ id }: { id: number }) {
  const { data, isPending, isError } = useCard(id)
  if (isPending) return <span className={styles.muted}>Loading…</span>
  if (isError) return <span className={styles.muted}>{cardLabel(id)} not available</span>
  return (
    <div className={styles.preview}>
      <div className={styles.previewTitle}>
        <span className={styles.dot} style={{ background: KIND_COLORS[data.kind] }} />
        <span className={styles.label}>{cardLabel(data.id)}</span>
        <strong>{data.title}</strong>
      </div>
      <p>{data.body.split('\n').slice(0, 6).join('\n') || <em>Empty card</em>}</p>
    </div>
  )
}
