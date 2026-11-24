import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, IconButton, TextInput } from '@primer/react'
import { CircleSlashIcon, PinIcon, PlusIcon, XIcon, AlertIcon } from '@primer/octicons-react'
import type { CardState, ContextCard, ContextItem } from '../../api/types.ts'
import { HoverCard } from '../../components/HoverCard.tsx'
import { useWorkspace } from '../../state/workspace.ts'
import { CardPreview } from '../cards/CardPreview.tsx'
import { useCards } from '../cards/hooks.ts'
import { cardLabel, KIND_COLORS } from '../cards/model.ts'
import { useContextPreview } from './hooks.ts'
import styles from './chat.module.css'

const toItems = (cards: ContextCard[]): ContextItem[] => cards.map((c) => ({ cardId: c.cardId, state: c.state }))

type Props = { conversationId: number; timelineId: number | null | undefined; draft: string }

/** Context tray (FR-06): the cards that will be sent with the next question, negotiable before sending. */
export function ContextTray({ conversationId, timelineId, draft }: Props) {
  const entry = useWorkspace((s) => s.chatContexts[conversationId])
  const sync = useWorkspace((s) => s.syncChatContext)
  const setTokens = useWorkspace((s) => s.setChatTokens)
  const edit = useWorkspace((s) => s.editChatContext)
  const reset = useWorkspace((s) => s.resetChatContext)
  const custom = entry?.custom ? entry.items : null
  const [picker, setPicker] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)

  const preview = useContextPreview(conversationId, timelineId, custom)
  const data = preview.isPlaceholderData ? undefined : preview.data

  useEffect(() => {
    if (!data) return
    if (custom) setTokens(conversationId, data.estimatedInputTokens)
    else sync(conversationId, toItems(data.cards), data.estimatedInputTokens)
  }, [data, custom, conversationId, sync, setTokens])

  const details = useMemo(() => new Map((preview.data?.cards ?? []).map((c) => [c.cardId, c])), [preview.data])
  const items: ContextItem[] = entry?.items ?? (preview.data ? toItems(preview.data.cards) : [])

  const change = (next: ContextItem[]) => edit(conversationId, next)
  const setState = (cardId: number, state: CardState) =>
    change(items.map((i) => (i.cardId === cardId ? { ...i, state } : i)))
  const dropped = preview.data?.droppedCardIds ?? []

  return (
    <section className={styles.tray} aria-label="Context tray">
      <div className={styles.trayChips}>
        {items.length === 0 && !preview.isPending && <span className={styles.muted}>No cards in context.</span>}
        {items.map((item) => {
          const d = details.get(item.cardId)
          const label = cardLabel(item.cardId)
          return (
            <span key={item.cardId} className={styles.ctxChip} data-state={item.state} data-dropped={dropped.includes(item.cardId) || undefined}>
              <HoverCard content={<CardPreview id={item.cardId} />}>
                <span className={styles.ctxName}>
                  {d && <span className={styles.dot} style={{ background: KIND_COLORS[d.kind] }} />}
                  <span className={styles.ctxId}>{label}</span>
                  <span className={styles.ctxTitle}>{d?.title ?? ''}</span>
                </span>
              </HoverCard>
              <IconButton
                icon={PinIcon}
                size="small"
                variant="invisible"
                aria-label={`Pin ${label}`}
                aria-pressed={item.state === 'pinned'}
                onClick={() => setState(item.cardId, item.state === 'pinned' ? 'included' : 'pinned')}
              />
              <IconButton
                icon={CircleSlashIcon}
                size="small"
                variant="invisible"
                aria-label={`Exclude ${label}`}
                aria-pressed={item.state === 'excluded'}
                onClick={() => setState(item.cardId, item.state === 'excluded' ? 'included' : 'excluded')}
              />
              <IconButton
                icon={XIcon}
                size="small"
                variant="invisible"
                aria-label={`Remove ${label}`}
                onClick={() => change(items.filter((i) => i.cardId !== item.cardId))}
              />
            </span>
          )
        })}
        <IconButton icon={PlusIcon} size="small" aria-label="Add card to context" onClick={() => setPicker(true)} />
      </div>
      <div className={styles.trayMeta}>
        {preview.isError && (
          <span className={styles.warn} role="alert">
            <AlertIcon size={12} /> {preview.error.message}
          </span>
        )}
        {dropped.length > 0 && (
          <span className={styles.warn} role="alert">
            <AlertIcon size={12} /> Over the token budget, not sent: {dropped.map(cardLabel).join(', ')}
          </span>
        )}
        <span className={styles.spacer} />
        {preview.data && <span aria-label="Token estimate">~{preview.data.estimatedInputTokens.toLocaleString('en')} input tokens</span>}
        {custom && (
          <Button size="small" variant="invisible" onClick={() => reset(conversationId)}>
            Reset to default
          </Button>
        )}
        <Button size="small" variant="invisible" disabled={timelineId == null} onClick={() => setShowPrompt(true)}>
          Show prompt
        </Button>
      </div>
      {picker && (
        <CardPicker
          taken={new Set(items.map((i) => i.cardId))}
          onPick={(id) => change([...items, { cardId: id, state: 'included' }])}
          onClose={() => setPicker(false)}
        />
      )}
      {showPrompt && (
        <PromptPreviewDialog conversationId={conversationId} timelineId={timelineId!} cards={custom} draft={draft} onClose={() => setShowPrompt(false)} />
      )}
    </section>
  )
}

export function CardPicker({ taken, onPick, onClose }: { taken: Set<number>; onPick: (id: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const { data } = useCards({ query: query.trim() })
  const [last, setLast] = useState<number | null>(null)
  return (
    <Dialog title="Add card to context" width="medium" onClose={onClose} footerButtons={[{ content: 'Done', buttonType: 'primary', onClick: onClose }]}>
      <TextInput block autoFocus aria-label="Search cards" placeholder="Search cards by title or text" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className={styles.pickerList}>
        {(data ?? []).map((c) => {
          const already = taken.has(c.id) || last === c.id
          return (
            <li key={c.id}>
              <button
                type="button"
                className={styles.pickerRow}
                disabled={already}
                onClick={() => {
                  setLast(c.id)
                  onPick(c.id)
                }}
              >
                <span className={styles.dot} style={{ background: KIND_COLORS[c.kind] }} />
                <span className={styles.ctxId}>{cardLabel(c.id)}</span>
                <span className={styles.ctxTitle}>{c.title}</span>
                {already && <span className={styles.muted}>in context</span>}
              </button>
            </li>
          )
        })}
        {data?.length === 0 && <li className={styles.muted}>No matching cards.</li>}
      </ul>
    </Dialog>
  )
}

function PromptPreviewDialog({ conversationId, timelineId, cards, draft, onClose }: { conversationId: number; timelineId: number; cards: ContextItem[] | null; draft: string; onClose: () => void }) {
  const { data, isPending, error } = useContextPreview(conversationId, timelineId, cards, { content: draft.trim() })
  return (
    <Dialog title="Assembled prompt" width="xlarge" onClose={onClose} footerButtons={[{ content: 'Close', onClick: onClose }]}>
      {isPending && <p className={styles.muted}>Loading…</p>}
      {error && <p role="alert">{error.message}</p>}
      {data && (
        <div className={styles.promptView}>
          <h4>System</h4>
          <pre>{data.prompt.system || '(empty)'}</pre>
          {data.prompt.messages.map((m, i) => (
            <div key={i}>
              <h4>{m.role}</h4>
              <pre>{m.content}</pre>
            </div>
          ))}
          <p className={styles.muted}>~{data.estimatedInputTokens.toLocaleString('en')} input tokens</p>
        </div>
      )}
    </Dialog>
  )
}
