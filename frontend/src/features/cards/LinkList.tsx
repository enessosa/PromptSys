import { IconButton } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import type { Card, Link } from '../../api/types.ts'
import { HoverCard } from '../../components/HoverCard.tsx'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { CardPreview } from './CardPreview.tsx'
import { useCards, useDeleteLink } from './hooks.ts'
import { cardLabel } from './model.ts'
import styles from './cards.module.css'

function LinkRow({ link, otherId, direction }: { link: Link; otherId: number; direction: 'out' | 'in' }) {
  const { data: cards } = useCards()
  const remove = useDeleteLink()
  const openTab = useWorkspace((s) => s.openTab)
  const title = cards?.find((c) => c.id === otherId)?.title ?? '…'
  return (
    <li className={styles.linkRow}>
      <span className={styles.muted} aria-hidden>
        {direction === 'out' ? '→' : '←'}
      </span>
      <HoverCard content={<CardPreview id={otherId} />}>
        <button className={styles.linkButton} onClick={() => openTab(makeTab('card', otherId), { preview: true })}>
          <span className={styles.label}>{cardLabel(otherId)}</span> {title}
        </button>
      </HoverCard>
      <span className={styles.muted}>
        {link.kind.replace('_', ' ')}
        {link.label ? ` · ${link.label}` : ''}
      </span>
      <IconButton
        icon={XIcon}
        size="small"
        variant="invisible"
        aria-label={`Remove link to ${cardLabel(otherId)}`}
        onClick={() => remove.mutate(link.id)}
      />
    </li>
  )
}

/** Links (outgoing) and backlinks (incoming) of a card. */
export function LinkList({ card }: { card: Pick<Card, 'links' | 'backlinks'> }) {
  if (card.links.length === 0 && card.backlinks.length === 0) {
    return <p className={styles.muted}>No links yet. Connect cards in the graph view.</p>
  }
  return (
    <ul className={styles.linkList}>
      {card.links.map((l) => (
        <LinkRow key={`o${l.id}`} link={l} otherId={l.targetId} direction="out" />
      ))}
      {card.backlinks.map((l) => (
        <LinkRow key={`i${l.id}`} link={l} otherId={l.sourceId} direction="in" />
      ))}
    </ul>
  )
}
