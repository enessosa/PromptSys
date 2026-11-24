import { useState } from 'react'
import { Button, TextInput, Textarea } from '@primer/react'
import type { ReviewStatus, SessionCard } from '../../api/types.ts'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { cardLabel } from '../cards/model.ts'
import { useReviewCard, useSessionCards } from './hooks.ts'
import styles from './code.module.css'

const REVIEW_LABEL: Record<ReviewStatus, string> = { proposed: 'Proposed', confirmed: 'Confirmed', corrected: 'Corrected', rejected: 'Rejected' }

/** Right-hand panel: cards the agent recorded in this session, to confirm, correct or reject. */
export function CardsPanel({ sessionId }: { sessionId: number }) {
  const cards = useSessionCards(sessionId)
  const review = useReviewCard(sessionId)
  const list = cards.data ?? []
  return (
    <aside className={styles.panel} aria-label="Cards from this session">
      <h3>Cards from this session</h3>
      <p className={styles.note}>Confirmed and corrected cards bind later turns of sessions in this project.</p>
      {cards.isError && <p role="alert" className={styles.error}>{cards.error.message}</p>}
      {!cards.isError && list.length === 0 && <p className={styles.note}>No cards yet.</p>}
      <ul>
        {list.map((c) => (
          <CardRow key={`${c.id}:${c.version}`} card={c} busy={review.isPending} onReview={(patch) => review.mutate({ id: c.id, ...patch })} />
        ))}
      </ul>
      {review.isError && <p role="alert" className={styles.error}>{review.error.message}</p>}
    </aside>
  )
}

function CardRow({ card, busy, onReview }: { card: SessionCard; busy: boolean; onReview: (patch: { reviewStatus?: 'confirmed' | 'rejected'; title?: string; body?: string }) => void }) {
  const openTab = useWorkspace((s) => s.openTab)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  return (
    <li className={styles.cardRow} data-review={card.reviewStatus}>
      <div className={styles.cardHead}>
        <button type="button" className={styles.link} aria-label={`Open ${cardLabel(card.id)}`} onClick={() => openTab(makeTab('card', card.id))}>
          {cardLabel(card.id)}
        </button>
        <span className={styles.reviewTag} data-review={card.reviewStatus}>{REVIEW_LABEL[card.reviewStatus]}</span>
      </div>
      {editing ? (
        <div className={styles.edit}>
          <TextInput block aria-label="Card title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea block rows={5} aria-label="Card text" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className={styles.actions}>
            <Button size="small" variant="primary" disabled={busy || !title.trim()} onClick={() => { onReview({ title: title.trim(), body }); setEditing(false) }}>
              Save correction
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <strong className={styles.cardTitle}>{card.title}</strong>
          <p className={styles.cardBody}>{card.body}</p>
          <div className={styles.actions}>
            <Button size="small" disabled={busy || card.reviewStatus === 'confirmed'} onClick={() => onReview({ reviewStatus: 'confirmed' })}>Confirm</Button>
            <Button size="small" disabled={busy} onClick={() => { setTitle(card.title); setBody(card.body); setEditing(true) }}>Correct</Button>
            <Button size="small" variant="danger" disabled={busy || card.reviewStatus === 'rejected'} onClick={() => onReview({ reviewStatus: 'rejected' })}>Reject</Button>
          </div>
        </>
      )}
    </li>
  )
}
