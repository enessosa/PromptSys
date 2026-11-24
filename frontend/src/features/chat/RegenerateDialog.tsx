import { useState } from 'react'
import { Checkbox, Dialog } from '@primer/react'
import type { ContextCard } from '../../api/types.ts'
import { cardLabel } from '../cards/model.ts'
import styles from './chat.module.css'

type Props = {
  /** The cards that were sent with the question of this answer. */
  cards: ContextCard[]
  onSubmit: (excludeCardIds: number[]) => void
  onClose: () => void
}

/** FR-08: pick the cards to leave out, then the answer is generated again on a new branch. */
export function RegenerateDialog({ cards, onSubmit, onClose }: Props) {
  const sent = cards.filter((c) => c.state !== 'excluded')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const submit = () => {
    onSubmit([...excluded])
    onClose()
  }
  return (
    <Dialog
      title="Regenerate without cards"
      width="medium"
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: excluded.size === 0 ? 'Regenerate' : `Regenerate without ${excluded.size} card${excluded.size === 1 ? '' : 's'}`, buttonType: 'primary', onClick: submit },
      ]}
    >
      <p className={styles.muted}>
        Tick the cards to leave out. The new answer becomes a new branch; the original stays in the branch list.
      </p>
      {sent.length === 0 && <p className={styles.muted}>No cards were sent with this question.</p>}
      <ul className={styles.pickerList}>
        {sent.map((c) => (
          <li key={c.cardId} className={styles.pickerRow} style={{ cursor: 'default' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
              <Checkbox checked={excluded.has(c.cardId)} onChange={() => toggle(c.cardId)} aria-label={`Leave out ${cardLabel(c.cardId)}`} />
              <span className={styles.ctxId}>{cardLabel(c.cardId)}</span>
              <span className={styles.ctxTitle}>{c.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
