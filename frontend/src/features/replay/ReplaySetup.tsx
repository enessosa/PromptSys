import { useState } from 'react'
import { Button, Checkbox, Dialog, Select, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, XIcon } from '@primer/octicons-react'
import { ApiError } from '../../api/client.ts'
import type { CardState, ChatMessage, ContextCard, ContextItem, ReplayMode, ReplayResponse } from '../../api/types.ts'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { useCard } from '../cards/hooks.ts'
import { cardLabel } from '../cards/model.ts'
import { failureText } from '../chat/errors.ts'
import { CardPicker } from '../chat/ContextTray.tsx'
import { useSetActiveTimeline } from '../chat/hooks.ts'
import { buildContextChanges, CARD_STATES, describeChanges, type CardEdit } from './contextChanges.ts'
import { useCreateReplay, useReplayDryRun } from './hooks.ts'
import styles from './replay.module.css'

type Props = {
  conversationId: number
  /** The message the branch starts from. */
  message: ChatMessage
  /** Cards of the turn that is changed (the context state of the question). */
  base: ContextCard[]
  /** Timeline whose following prompts are replayed. */
  sourceTimelineId: number | null
  onClose: () => void
}

/** FR-17, FR-20, FR-21: change the context at a branch point, see the pending prompts and API calls, then create the replay. */
export function ReplaySetup({ conversationId, message, base, sourceTimelineId, onClose }: Props) {
  const baseItems: ContextItem[] = base.map((c) => ({ cardId: c.cardId, state: c.state }))
  const titles = new Map(base.map((c) => [c.cardId, c.title]))
  const [items, setItems] = useState<ContextItem[]>(baseItems)
  const [edits, setEdits] = useState<Record<number, CardEdit>>({})
  const [editing, setEditing] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [mode, setMode] = useState<ReplayMode>('step')
  const [warned, setWarned] = useState(false)
  const [estimate, setEstimate] = useState<ReplayResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dry = useReplayDryRun()
  const create = useCreateReplay(conversationId)
  const setActive = useSetActiveTimeline()
  const openTab = useWorkspace((s) => s.openTab)
  const setNotice = useWorkspace((s) => s.setNotice)
  const setExpected = useWorkspace((s) => s.setExpectedCalls)

  const changes = buildContextChanges(baseItems, items, edits)
  const input = { fromMessageId: message.id, contextChanges: changes, mode, ...(sourceTimelineId !== null ? { sourceTimelineId } : {}) }
  const modeOk = mode === 'step' || warned
  const known = new Set(base.map((c) => c.cardId))

  const touch = () => {
    setEstimate(null)
    setError(null)
    setExpected(null)
  }
  const close = () => {
    setExpected(null)
    onClose()
  }
  const fail = (e: unknown) => setError(e instanceof ApiError ? (e.status === 400 ? `${e.message} Pick an earlier message that has prompts after it.` : failureText(e.code, e.message)) : e instanceof Error ? e.message : 'The replay failed.')

  const setState = (cardId: number, state: CardState) => {
    touch()
    setItems((prev) => prev.map((i) => (i.cardId === cardId ? { ...i, state } : i)))
  }

  const estimateCalls = () => {
    setError(null)
    dry.mutate(input, {
      onSuccess: (r) => {
        setEstimate(r)
        setExpected(r.estimatedApiCalls)
      },
      onError: fail,
    })
  }

  const start = () =>
    create.mutate(input, {
      onSuccess: async (r) => {
        if (!r.timeline) return
        try {
          await setActive.mutateAsync({ id: conversationId, timelineId: r.timeline.id })
        } catch (e) {
          fail(e)
          return
        }
        openTab(makeTab('chat', conversationId))
        setNotice(mode === 'step' ? 'Replay created. Send, edit or skip the next prompt.' : 'Replay created. Press "Run all" to start.')
        close()
      },
      onError: fail,
    })

  return (
    <Dialog
      title="Branch from here"
      width="xlarge"
      onClose={close}
      footerButtons={[
        { content: 'Cancel', onClick: close },
        ...(estimate
          ? [{ content: `Create (${estimate.estimatedApiCalls} API call${estimate.estimatedApiCalls === 1 ? '' : 's'})`, buttonType: 'primary' as const, onClick: start, disabled: create.isPending || !modeOk }]
          : [{ content: 'Estimate API calls', buttonType: 'primary' as const, onClick: estimateCalls, disabled: dry.isPending || !modeOk }]),
      ]}
    >
      <div className={styles.dialog}>
        <p className={styles.muted}>
          A new timeline starts after this message with the context below; the original stays unchanged. The following original prompts can be replayed on it.
        </p>

        <h4>Context for this turn</h4>
        <ul className={styles.cards}>
          {items.length === 0 && <li className={styles.muted}>No cards in the context.</li>}
          {items.map((i) => (
            <li key={i.cardId}>
              <div className={styles.cardRow}>
                <span className={styles.id}>{cardLabel(i.cardId)}</span>
                <span className={styles.title}>{edits[i.cardId]?.title ?? titles.get(i.cardId) ?? ''}</span>
                {edits[i.cardId] && <span className={styles.muted}>edited → fork</span>}
                {!known.has(i.cardId) && <span className={styles.muted}>added</span>}
                <Select size="small" aria-label={`State of ${cardLabel(i.cardId)}`} value={i.state} onChange={(e) => setState(i.cardId, e.target.value as CardState)}>
                  {CARD_STATES.map((s) => (
                    <Select.Option key={s} value={s}>
                      {s}
                    </Select.Option>
                  ))}
                </Select>
                <Button size="small" variant="invisible" leadingVisual={PencilIcon} aria-label={`Edit text of ${cardLabel(i.cardId)}`} onClick={() => setEditing(editing === i.cardId ? null : i.cardId)}>
                  Edit text
                </Button>
                {!known.has(i.cardId) && (
                  <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={XIcon}
                    aria-label={`Remove ${cardLabel(i.cardId)}`}
                    onClick={() => {
                      touch()
                      setItems((prev) => prev.filter((x) => x.cardId !== i.cardId))
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
              {editing === i.cardId && (
                <CardTextEdit
                  cardId={i.cardId}
                  edit={edits[i.cardId]}
                  onChange={(e) => {
                    touch()
                    setEdits((prev) => {
                      const next = { ...prev }
                      if (e) next[i.cardId] = e
                      else delete next[i.cardId]
                      return next
                    })
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        <div>
          <Button size="small" leadingVisual={PlusIcon} onClick={() => setPicker(true)}>
            Add card
          </Button>
        </div>

        <h4>Replay mode</h4>
        <div className={styles.modes}>
          <label>
            <input type="radio" name="replay-mode" checked={mode === 'step'} onChange={() => { setMode('step'); touch() }} />
            Step by step (recommended): you send, edit or skip each original prompt
          </label>
          <label>
            <input type="radio" name="replay-mode" checked={mode === 'auto'} onChange={() => { setMode('auto'); touch() }} />
            Automatic: all following prompts are sent in a row
          </label>
          {mode === 'auto' && (
            <label className={styles.warn}>
              <Checkbox checked={warned} onChange={(e) => { setWarned(e.target.checked); touch() }} aria-label="I understand the risk of an automatic replay" />
              Later prompts may no longer fit the changed answers, and every prompt costs an API call. I understand.
            </label>
          )}
        </div>

        {estimate && (
          <div className={styles.estimate} role="status">
            <strong>
              {estimate.pendingPrompts.length} prompt{estimate.pendingPrompts.length === 1 ? '' : 's'} to replay · expected {estimate.estimatedApiCalls} API call{estimate.estimatedApiCalls === 1 ? '' : 's'}
            </strong>
            <p className={styles.muted}>Context: {describeChanges(baseItems, changes)}. Nothing is sent until you confirm.</p>
            <ol className={styles.pending}>
              {estimate.pendingPrompts.map((p) => (
                <li key={p.messageId}>{p.content}</li>
              ))}
            </ol>
          </div>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      {picker && (
        <CardPicker
          taken={new Set(items.map((i) => i.cardId))}
          onPick={(id) => {
            touch()
            setItems((prev) => [...prev, { cardId: id, state: 'included' }])
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </Dialog>
  )
}

/** Title and text of a card; a changed value is sent as an edit and becomes a forked card in the branch. */
function CardTextEdit({ cardId, edit, onChange }: { cardId: number; edit: CardEdit | undefined; onChange: (edit: CardEdit | null) => void }) {
  const card = useCard(cardId)
  if (card.isPending) return <p className={styles.muted}>Loading…</p>
  if (card.isError) return <p role="alert">{card.error.message}</p>
  const original = card.data
  const title = edit?.title ?? original.title
  const body = edit?.body ?? original.body
  const update = (next: { title: string; body: string }) => {
    const e: CardEdit = {}
    if (next.title !== original.title) e.title = next.title
    if (next.body !== original.body) e.body = next.body
    onChange(e.title === undefined && e.body === undefined ? null : e)
  }
  return (
    <div className={styles.edit}>
      <TextInput aria-label={`Title of ${cardLabel(cardId)}`} value={title} onChange={(e) => update({ title: e.target.value, body })} />
      <textarea aria-label={`Text of ${cardLabel(cardId)}`} rows={5} value={body} onChange={(e) => update({ title, body: e.target.value })} />
      <span className={styles.muted}>The edit creates a new card (fork) used in this branch only; the original card is not changed.</span>
    </div>
  )
}
