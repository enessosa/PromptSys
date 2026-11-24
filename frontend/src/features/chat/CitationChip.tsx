import type { ReactNode } from 'react'
import { AlertIcon } from '@primer/octicons-react'
import type { AblationLabel } from '../../api/types.ts'
import { badgeText } from '../ablation/model.ts'
import { HoverCard } from '../../components/HoverCard.tsx'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { CardPreview } from '../cards/CardPreview.tsx'
import { useMode } from '../code/hooks.ts'
import { GATED_TIP } from '../code/model.ts'
import { cardLabel } from '../cards/model.ts'
import styles from './chat.module.css'

type Props = {
  /** Text shown in the chip, e.g. `[c3]`. */
  marker: string
  /** Card the marker points to (merged ids already resolved by the backend); null = unknown card. */
  cardId: number | null
  /** Valid = the card was part of the prompt. Invalid chips are muted with a warning icon. */
  valid?: boolean
  /** When given, a small "Why?" button starts an ablation for this card. */
  onWhy?: (cardId: number) => void
  /** Stored ablation result of this card for the answer: shown as a small badge. */
  score?: { label: AblationLabel; effect: number }
}

export function CitationChip({ marker, cardId, valid = true, onWhy, score }: Props) {
  const openTab = useWorkspace((s) => s.openTab)
  const chip = (
    <button
      type="button"
      className={styles.chip}
      data-valid={valid}
      aria-label={valid ? `Open ${marker}` : `${marker} (not in the prompt)`}
      title={valid ? undefined : 'This card was not part of the prompt or does not exist.'}
      disabled={cardId === null}
      onClick={() => cardId !== null && openTab(makeTab('card', cardId))}
    >
      {!valid && <AlertIcon size={12} />}
      {marker}
    </button>
  )
  if (cardId === null) return <span className={styles.chipWrap}>{chip}</span>
  return (
    <span className={styles.chipWrap}>
      <HoverCard content={<CardPreview id={cardId} />}>{chip}</HoverCard>
      {valid && score && (
        <span className={styles.badge} data-label={score.label} title="Ablation result: how much this card changed the answer" aria-label={`Ablation ${badgeText(score)}`}>
          {badgeText(score)}
        </span>
      )}
      {valid && onWhy && <WhyButton marker={marker} onClick={() => onWhy(cardId)} />}
    </span>
  )
}

/** Chip for a card id without a text marker (used / not used rows). */
export function CardRefChip({ cardId, children, onWhy, score }: { cardId: number; children?: ReactNode } & Pick<Props, 'onWhy' | 'score'>) {
  return <CitationChip marker={children ? String(children) : cardLabel(cardId)} cardId={cardId} onWhy={onWhy} score={score} />
}

function WhyButton({ marker, onClick }: { marker: string; onClick: () => void }) {
  const { claudeCode } = useMode()
  return (
    <button type="button" className={styles.why} aria-label={`Why ${marker}?`} disabled={claudeCode} title={claudeCode ? GATED_TIP : undefined} onClick={onClick}>
      Why?
    </button>
  )
}
