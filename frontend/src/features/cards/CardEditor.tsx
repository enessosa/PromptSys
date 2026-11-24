import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { Button, Checkbox, Dialog, FormControl, Select, TextInput } from '@primer/react'
import { api, ApiError } from '../../api/client.ts'
import { CARD_KINDS, type Card, type CardKind } from '../../api/types.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { EmptyState } from '../../components/EmptyState.tsx'
import { MergeDialog } from '../graph/MergeDialog.tsx'
import { LinkList } from './LinkList.tsx'
import { useCard, useCardVersions, useCards, useUpdateCard } from './hooks.ts'
import { cardLabel } from './model.ts'
import styles from './cards.module.css'

export const AUTOSAVE_DELAY_MS = 800

type Base = { version: number; title: string; body: string }

export function CardEditor({ cardId }: { cardId: number }) {
  const { data: card, isPending, error } = useCard(cardId)
  if (isPending) return <EmptyState title="Loading…" />
  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return <EmptyState title={missing ? `${cardLabel(cardId)} does not exist` : 'Card could not be loaded'}>{error.message}</EmptyState>
  }
  return <EditorForm key={card.id} card={card} />
}

function EditorForm({ card }: { card: Card }) {
  const update = useUpdateCard()
  const [draft, setDraft] = useState({ title: card.title, body: card.body })
  const [base, setBase] = useState<Base>({ version: card.version, title: card.title, body: card.body })
  const [conflict, setConflict] = useState<Card | null>(null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const addToChatContext = useWorkspace((s) => s.addToChatContext)
  const setNotice = useWorkspace((s) => s.setNotice)

  const dirty = draft.title !== base.title || draft.body !== base.body
  const titleValid = draft.title.trim() !== ''

  // Someone else changed the card (e.g. a merge) while there is nothing unsaved: follow the server.
  if (!dirty && !conflict && card.version !== base.version) {
    setBase({ version: card.version, title: card.title, body: card.body })
    setDraft({ title: card.title, body: card.body })
  }

  const { mutate: save, isPending: saving } = update
  useEffect(() => {
    if (!dirty || !titleValid || conflict || saving) return
    const timer = window.setTimeout(() => {
      save(
        { id: card.id, title: draft.title.trim(), body: draft.body, ifVersion: base.version },
        {
          onSuccess: (saved) => {
            setError(null)
            setBase({ version: saved.version, title: saved.title, body: saved.body })
          },
          onError: async (e) => {
            if (e instanceof ApiError && e.code === 'version_conflict') {
              try {
                setConflict(await api<Card>(`/api/cards/${card.id}`))
              } catch {
                setError(e.message)
              }
            } else {
              setError(e.message)
            }
          },
        },
      )
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, titleValid, conflict, saving, draft, base.version, card.id, save])

  // Do not lose a pending edit when the tab is closed within the debounce window.
  const latest = useRef({ draft, base, dirty, titleValid, conflict })
  useEffect(() => {
    latest.current = { draft, base, dirty, titleValid, conflict }
  })
  useEffect(() => {
    const id = card.id
    return () => {
      const l = latest.current
      if (l.dirty && l.titleValid && !l.conflict) {
        void api(`/api/cards/${id}`, {
          method: 'PATCH',
          body: { title: l.draft.title.trim(), body: l.draft.body, ifVersion: l.base.version },
        }).catch(() => undefined)
      }
    }
  }, [card.id])

  const patchMeta = (patch: { kind?: CardKind; folderPath?: string; defaultIncluded?: boolean }) =>
    update.mutate({ id: card.id, ...patch }, { onError: (e) => setError(e.message) })

  const resolveConflict = (keepMine: boolean) => {
    if (!conflict) return
    setBase({ version: conflict.version, title: conflict.title, body: conflict.body })
    if (!keepMine) setDraft({ title: conflict.title, body: conflict.body })
    setConflict(null)
  }

  const status = conflict
    ? 'Conflict'
    : !titleValid
      ? 'Title required'
      : saving
        ? 'Saving…'
        : dirty
          ? 'Unsaved changes'
          : `Saved · v${base.version}`

  return (
    <div className={styles.editor}>
      {conflict && (
        <div className={styles.banner} role="alert">
          <span>This card was changed elsewhere (now version {conflict.version}).</span>
          <Button size="small" onClick={() => resolveConflict(false)}>
            Load their version
          </Button>
          <Button size="small" variant="primary" onClick={() => resolveConflict(true)}>
            Keep mine
          </Button>
        </div>
      )}
      {error && (
        <div className={styles.banner} role="alert">
          {error}
        </div>
      )}
      <div className={styles.editorHead}>
        <span className={styles.label}>{cardLabel(card.id)}</span>
        <input
          className={styles.titleInput}
          aria-label="Title"
          value={draft.title}
          maxLength={200}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <span className={styles.status} aria-live="polite">
          {status}
        </span>
      </div>

      <div className={styles.props}>
        <label>
          Kind
          <Select
            size="small"
            aria-label="Kind"
            value={card.kind}
            onChange={(e) => patchMeta({ kind: e.target.value as CardKind })}
          >
            {CARD_KINDS.map((k) => (
              <Select.Option key={k} value={k}>
                {k}
              </Select.Option>
            ))}
          </Select>
        </label>
        <FolderField value={card.folderPath} onCommit={(folderPath) => patchMeta({ folderPath })} />
        <label className={styles.check}>
          <Checkbox
            checked={card.defaultIncluded}
            onChange={(e) => patchMeta({ defaultIncluded: e.target.checked })}
          />
          Include by default
        </label>
        <span className={styles.spacer} />
        <Button size="small" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
          {preview ? 'Edit' : 'Preview'}
        </Button>
        <Button
          size="small"
          onClick={() =>
            setNotice(addToChatContext([card.id]) ? `${cardLabel(card.id)} added to the context.` : 'Open a conversation first.')
          }
        >
          Add to context
        </Button>
        <Button size="small" onClick={() => setShowHistory(true)}>
          History
        </Button>
        <Button size="small" onClick={() => setMergeOpen(true)}>
          Merge into…
        </Button>
      </div>

      {preview ? (
        <div className={styles.markdown} data-testid="preview">
          <Markdown>{draft.body || '*Empty card*'}</Markdown>
        </div>
      ) : (
        <textarea
          className={styles.body}
          aria-label="Body"
          value={draft.body}
          placeholder="Write Markdown here…"
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
        />
      )}

      <div className={styles.links}>
        <h3>Links</h3>
        <LinkList card={card} />
      </div>

      {showHistory && (
        <HistoryDialog
          card={card}
          onClose={() => setShowHistory(false)}
          onRestore={(v) => {
            setDraft({ title: v.title, body: v.body })
            setShowHistory(false)
          }}
        />
      )}
      {mergeOpen && <MergeIntoDialog card={card} onClose={() => setMergeOpen(false)} />}
    </div>
  )
}

/** Folder text field that commits on blur / Enter, so a PATCH is not sent per keystroke. */
function FolderField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  const commit = () => text.trim() !== value && onCommit(text.trim())
  return (
    <label>
      Folder
      <TextInput
        size="small"
        aria-label="Folder"
        placeholder="(root)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  )
}

function HistoryDialog({
  card,
  onClose,
  onRestore,
}: {
  card: Card
  onClose: () => void
  onRestore: (v: { title: string; body: string }) => void
}) {
  const { data, isPending } = useCardVersions(card.id, true)
  return (
    <Dialog title={`History of ${cardLabel(card.id)}`} onClose={onClose} width="medium">
      {isPending && <p className={styles.muted}>Loading…</p>}
      <ul className={styles.history}>
        {data
          ?.slice()
          .sort((a, b) => b.version - a.version)
          .map((v) => (
            <li key={v.version}>
              <div>
                <strong>v{v.version}</strong> <span className={styles.muted}>{new Date(v.createdAt).toLocaleString()}</span>
                {v.version === card.version && <span className={styles.muted}> · current</span>}
              </div>
              <div className={styles.historyTitle}>{v.title}</div>
              {v.version !== card.version && (
                <Button size="small" onClick={() => onRestore(v)}>
                  Restore as draft
                </Button>
              )}
            </li>
          ))}
      </ul>
    </Dialog>
  )
}

/** Picks the card to merge this one into, then opens the shared merge dialog. */
function MergeIntoDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { data: cards } = useCards()
  const [targetId, setTargetId] = useState<number | null>(null)
  const others = (cards ?? []).filter((c) => c.id !== card.id)
  if (targetId !== null) return <MergeDialog cardIds={[targetId, card.id]} onClose={onClose} />
  return (
    <Dialog
      title={`Merge ${cardLabel(card.id)} into…`}
      onClose={onClose}
      width="small"
      footerButtons={[{ content: 'Cancel', onClick: onClose }]}
    >
      <FormControl>
        <FormControl.Label>Surviving card</FormControl.Label>
        <Select block onChange={(e) => setTargetId(Number(e.target.value))} value="">
          <Select.Option value="" disabled>
            Choose a card…
          </Select.Option>
          {others.map((c) => (
            <Select.Option key={c.id} value={String(c.id)}>
              {cardLabel(c.id)} {c.title}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
    </Dialog>
  )
}
