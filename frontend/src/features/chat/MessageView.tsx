import { memo, useMemo, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import { Button } from '@primer/react'
import { SyncIcon } from '@primer/octicons-react'
import type { AblationCardResult, ChatMessage, Citation, ContextCard } from '../../api/types.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { useAblations } from '../ablation/hooks.ts'
import { CardRefChip, CitationChip } from './CitationChip.tsx'
import { errorText } from './errors.ts'
import { markerLookup, remarkCitations, type MarkerInfo } from './citations.ts'
import { codeComponents, rehypeCode, remarkMarkdown } from '../../components/codeMarkdown.ts'
import prose from '../../components/prose.module.css'
import styles from './chat.module.css'

const remarkPlugins = [...remarkMarkdown, remarkCitations]

/** Assistant text as Markdown; `[cN]` becomes a chip, valid or not as the backend resolved it. */
export type ChipExtras = {
  onWhy?: (cardId: number) => void
  scores?: Map<number, Pick<AblationCardResult, 'label' | 'effect'>>
}

export function AssistantText({ text, citations, onWhy, scores }: { text: string; citations: Citation[] } & ChipExtras) {
  const lookup = useMemo(() => markerLookup(citations), [citations])
  const components = useMemo(
    () =>
      ({
        ...codeComponents,
        'cite-marker': ({ marker }: { marker?: string }) => {
          const m = marker ?? ''
          const info: MarkerInfo | undefined = lookup.get(m)
          // Not resolved yet (still streaming): show it as a normal chip pointing at the written id.
          const cardId = info ? info.cardId : Number(m.slice(2, -1))
          return <CitationChip marker={m} cardId={cardId} valid={info ? info.valid : true} onWhy={onWhy} score={cardId === null ? undefined : scores?.get(cardId)} />
        },
      }) as unknown as Components,
    [lookup, onWhy, scores],
  )
  return (
    <div className={`${styles.markdown} ${prose.prose}`}>
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypeCode} components={components}>
        {text}
      </Markdown>
    </div>
  )
}

export function StatusNote({ status, errorCode }: { status: ChatMessage['status']; errorCode: string | null }) {
  if (status === 'stopped') return <p className={styles.note}>Stopped. This answer is partial.</p>
  if (status === 'error') {
    return (
      <p className={styles.noteError} role="alert">
        {errorText(errorCode)} The text above is partial.
      </p>
    )
  }
  if (status === 'streaming') return <p className={styles.note}>Still generating or interrupted.</p>
  return null
}

/** FR-05: which sent cards the model cited ("used") and which it did not. */
export function UsedCardsRow({ used, unused, onWhy, scores }: { used: number[]; unused: number[] } & ChipExtras) {
  if (used.length === 0 && unused.length === 0) return null
  return (
    <div className={styles.cardsRow} aria-label="Cards of this answer">
      <span className={styles.rowLabel}>Cards</span>
      <span>used</span>
      {used.length === 0 ? <span className={styles.muted}>none</span> : used.map((id) => <CardRefChip key={id} cardId={id} onWhy={onWhy} score={scores?.get(id)} />)}
      <span className={styles.dotSep}>·</span>
      <span>not used</span>
      {unused.length === 0 ? <span className={styles.muted}>none</span> : unused.map((id) => <CardRefChip key={id} cardId={id} onWhy={onWhy} score={scores?.get(id)} />)}
      <span className={styles.hint}>cited by the model</span>
    </div>
  )
}

type Props = {
  message: ChatMessage
  selected?: boolean
  busy?: boolean
  onSelect?: () => void
  onRegenerate?: () => void
  /** Further actions next to "Regenerate" (e.g. "Branch from here"); shown on user messages too. */
  extraActions?: ReactNode
  /** Content below the actions (e.g. the derived rules of this answer). */
  below?: ReactNode
  /** The cards that were sent with the question of this answer; enables "Why?" on the chips. */
  sentCards?: ContextCard[]
}

export const MessageView = memo(function MessageView({ message, selected, busy, onSelect, onRegenerate, extraActions, below, sentCards }: Props) {
  const openWhy = useWorkspace((s) => s.openWhy)
  const finished = message.role === 'assistant' && message.status !== 'streaming' && message.content !== ''
  const ablations = useAblations(message.id, finished)
  const scores = useMemo(() => new Map((ablations.data?.cards ?? []).map((c) => [c.cardId, c])), [ablations.data])
  const whyCards = useMemo(() => (sentCards ?? []).filter((c) => c.state !== 'excluded').map((c) => ({ cardId: c.cardId, title: c.title })), [sentCards])
  const onWhy = useMemo(
    () =>
      finished && whyCards.length > 0
        ? (cardId: number) => openWhy({ messageId: message.id, answerText: message.content, cards: whyCards, cardId })
        : undefined,
    [finished, whyCards, openWhy, message.id, message.content],
  )

  if (message.role === 'user') {
    return (
      <article className={styles.message} data-role="user" data-selected={selected || undefined} aria-label="Your message" onClick={onSelect}>
        <div className={styles.userText}>{message.content}</div>
        {extraActions && <div className={styles.actions}>{extraActions}</div>}
      </article>
    )
  }
  return (
    <article className={styles.message} data-role="assistant" data-selected={selected || undefined} aria-label="Answer" onClick={onSelect}>
      {message.content ? <AssistantText text={message.content} citations={message.citations} onWhy={onWhy} scores={scores} /> : null}
      <StatusNote status={message.status} errorCode={message.errorCode} />
      <UsedCardsRow used={message.usedCardIds} unused={message.unusedCardIds} onWhy={onWhy} scores={scores} />
      <div className={styles.actions}>
        {onRegenerate && (
          <Button size="small" variant="invisible" leadingVisual={SyncIcon} disabled={busy} onClick={onRegenerate}>
            Regenerate without cards…
          </Button>
        )}
        {extraActions}
      </div>
      {below}
    </article>
  )
})
