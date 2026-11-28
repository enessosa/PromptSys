import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Button, Textarea } from '@primer/react'
import { DiffIcon, SidebarExpandIcon, SquareFillIcon, XIcon } from '@primer/octicons-react'
import { ApiError } from '../../api/client.ts'
import { EmptyState } from '../../components/EmptyState.tsx'
import { ChangesPanel } from './ChangesPanel.tsx'
import { imageUrl, useCodeSession, useCodeStatus, useGitInfo, useRemoveQueued, useResolveApproval, useSendMessage, useSetPermissionMode, useStopSession } from './hooks.ts'
import { ModeSwitch } from './ModeSwitch.tsx'
import { useCards } from '../cards/hooks.ts'
import { cardMatches, cardMention, formatCost, IMAGE_MAX_BYTES, IMAGE_MAX_COUNT, imageFromDataUrl, isPasteImageType, nextMode, slashMatches, STATUS_LABEL, type PastedImage } from './model.ts'
import { SidePanel, type SideTab } from './SidePanel.tsx'
import { StatusLine } from './StatusLine.tsx'
import { Timeline } from './Timeline.tsx'
import styles from './code.module.css'

type Suggestion = { key: string; label: string; detail?: string; apply: () => string }

type Attachment = PastedImage & { key: string }

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })

export function CodeSessionView({ sessionId }: { sessionId: number }) {
  const status = useCodeStatus()
  const { detail, state, setMode } = useCodeSession(sessionId)

  if (detail.error instanceof ApiError && detail.error.code === 'feature_requires_claude_code_mode') {
    return (
      <EmptyState title="Agent mode is off">
        Sessions need the Agent mode.
        <ModeSwitch />
      </EmptyState>
    )
  }
  if (status.data && !status.data.available) {
    return <EmptyState title="Claude Code is not available">{status.data.reason ?? 'The agent runtime could not be started.'}</EmptyState>
  }
  if (detail.isPending) return <EmptyState title="Loading…" />
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404
    return <EmptyState title={missing ? 'This session does not exist' : 'Session could not be loaded'}>{detail.error.message}</EmptyState>
  }
  return <SessionBody sessionId={sessionId} title={detail.data.session.title} projectPath={detail.data.session.projectPath} state={state} setMode={setMode} showCost={status.data?.codeAuth === 'api_key'} />
}

type BodyProps = { sessionId: number; title: string; projectPath: string; state: ReturnType<typeof useCodeSession>['state']; setMode: ReturnType<typeof useCodeSession>['setMode']; showCost: boolean }

const changesKey = (id: number) => `promptsys.code.changes.${id}`

function loadChangesOpen(id: number): boolean {
  try {
    return localStorage.getItem(changesKey(id)) === '1'
  } catch {
    return false
  }
}

const sideKey = (id: number) => `promptsys.code.sidetab.${id}`

function loadSideTab(id: number): SideTab {
  try {
    return localStorage.getItem(sideKey(id)) === 'agents' ? 'agents' : 'cards'
  } catch {
    return 'cards'
  }
}

function SessionBody({ sessionId, title, projectPath, state, setMode, showCost }: BodyProps) {
  const send = useSendMessage(sessionId)
  const approve = useResolveApproval(sessionId)
  const stop = useStopSession(sessionId)
  const unqueue = useRemoveQueued(sessionId)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [panel, setPanel] = useState(true)
  const [changesOpen, setChangesOpen] = useState(() => loadChangesOpen(sessionId))
  const permission = useSetPermissionMode(sessionId)
  const git = useGitInfo(sessionId, state.turns)
  const [sideTab, setSideTab] = useState<SideTab>(() => loadSideTab(sessionId))
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const busy = state.status === 'running' || state.status === 'waiting_approval'
  const allCards = useCards().data
  const mention = cardMention(draft)
  // One list for the picker: slash commands at the start, cards after "@".
  const slash = slashMatches(draft, state.slashCommands)
  const cardHits = slash.length === 0 && mention ? cardMatches(allCards ?? [], mention.query) : []
  const matches: Suggestion[] = slash.length > 0
    ? slash.map((c) => ({ key: `/${c}`, label: `/${c}`, apply: () => `/${c} ` }))
    : cardHits.map((c) => ({ key: `c${c.id}`, label: `c${c.id} ${c.title}`, detail: c.folderPath, apply: () => `${draft.slice(0, mention?.start ?? draft.length)}[c${c.id}] ` }))
  // With the local login the SDK still reports what the turn would cost at API prices; nothing is billed, so it is hidden.
  const cost = showCost ? state.lastResult?.costUsd : undefined

  // Follows new output only while the user is at the bottom; scrolling up to read stops it until they scroll back down.
  const stick = useRef(true)
  const onScroll = () => {
    const el = scroller.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  const thinking = state.status === 'running'
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [state.items, thinking])

  const chooseTab = (tab: SideTab) => {
    setSideTab(tab)
    try {
      localStorage.setItem(sideKey(sessionId), tab)
    } catch {
      // storage unavailable: the tab just is not remembered
    }
  }

  // The first agent that starts while this view is open brings the Agents tab to the front.
  const agentCount = useRef(state.agents.length)
  useEffect(() => {
    if (agentCount.current === 0 && state.agents.length > 0) {
      chooseTab('agents')
      setPanel(true)
    }
    agentCount.current = state.agents.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.agents.length])

  const showAgent = (id: string) => {
    chooseTab('agents')
    setPanel(true)
    setExpandedAgent(id)
  }

  const toggleChanges = () => {
    const next = !changesOpen
    setChangesOpen(next)
    try {
      localStorage.setItem(changesKey(sessionId), next ? '1' : '0')
    } catch {
      // storage unavailable: the state just is not remembered
    }
  }

  const changeMode = (mode: Parameters<typeof setMode>[0]) => {
    const before = state.permissionMode
    setMode(mode)
    permission.mutate(mode, { onError: () => setMode(before) })
  }

  /** While the agent works, the message is queued (like in the terminal) and runs when the turn ends. */
  const submit = () => {
    const text = draft.trim()
    if ((!text && attachments.length === 0) || send.isPending) return
    setError(null)
    stick.current = true
    send.mutate({ text, images: attachments.map(({ mediaType, data }) => ({ mediaType, data })) }, {
      onSuccess: () => {
        setDraft('')
        setAttachments([])
      },
      onError: (e) => setError(e instanceof ApiError && e.code === 'queue_full' ? 'Too many messages are waiting; remove one or wait for the agent.' : e.message),
    })
  }

  /** Esc interrupts, like in the terminal; queued messages come back into the input field to be edited or sent again. */
  const interrupt = () => {
    if (!busy || stop.isPending) return
    const waiting = state.queue.map((m) => m.text)
    stop.mutate(undefined, {
      onSuccess: () => {
        if (waiting.length > 0) setDraft((d) => [...waiting, d.trim()].filter(Boolean).join('\n\n'))
      },
    })
  }
  const interruptRef = useRef(interrupt)
  useEffect(() => {
    interruptRef.current = interrupt
  })
  useEffect(() => {
    if (!busy) return
    const onEsc = (e: globalThis.KeyboardEvent) => {
      // Not while a dialog (command palette, …) is open or another handler already used the key (suggestion list).
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      interruptRef.current()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [busy])

  const choose = (s: Suggestion) => {
    setDraft(s.apply())
    setPick(0)
  }

  /** Images pasted or dropped into the input go with the next message, like a paste in the terminal. */
  const addImages = async (files: File[]) => {
    const images = files.filter((f) => isPasteImageType(f.type))
    if (images.length === 0) return
    const tooBig = images.filter((f) => f.size > IMAGE_MAX_BYTES)
    if (tooBig.length > 0) setError(`Images can be at most 5 MB (${tooBig.map((f) => f.name || 'pasted image').join(', ')}).`)
    const read = await Promise.all(images.filter((f) => f.size <= IMAGE_MAX_BYTES).map((f) => readAsDataUrl(f).then(imageFromDataUrl).catch(() => null)))
    const added = read.filter((i): i is PastedImage => i !== null).map((i) => ({ ...i, key: crypto.randomUUID() }))
    setAttachments((all) => {
      const next = [...all, ...added]
      if (next.length > IMAGE_MAX_COUNT) setError(`At most ${IMAGE_MAX_COUNT} images per message.`)
      return next.slice(0, IMAGE_MAX_COUNT)
    })
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // Screenshots (Cmd+Ctrl+Shift+4) arrive as clipboard items of kind "file"; some sources fill only `files`.
    const fromItems = [...e.clipboardData.items].filter((i) => i.kind === 'file' && isPasteImageType(i.type)).map((i) => i.getAsFile()).filter((f): f is File => f !== null)
    const files = fromItems.length > 0 ? fromItems : [...e.clipboardData.files].filter((f) => isPasteImageType(f.type))
    if (files.length === 0) return
    // A copied image often comes with its file name or HTML as text; only the image is wanted then.
    e.preventDefault()
    void addImages(files)
  }

  const CARD_TYPE = 'application/x-promptsys-card'
  const onDragOver = (e: DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer.types.includes(CARD_TYPE) || e.dataTransfer.types.includes('Files')) e.preventDefault()
  }
  /** A card dragged from the card tree becomes a [cN] reference at the end of the draft; dropped images are attached. */
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = [...e.dataTransfer.files]
    if (files.length > 0) {
      e.preventDefault()
      void addImages(files)
      return
    }
    const id = Number(e.dataTransfer.getData(CARD_TYPE))
    if (!Number.isInteger(id) || id <= 0) return
    e.preventDefault()
    setDraft((d) => `${d}${d === '' || /\s$/.test(d) ? '' : ' '}[c${id}] `)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      changeMode(nextMode(state.permissionMode))
      return
    }
    if (matches.length > 0) {
      if (e.key === 'Escape') {
        // Closes nothing yet, but must not interrupt the agent while the list is open.
        e.preventDefault()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPick((pick + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((pick - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        choose(matches[Math.min(pick, matches.length - 1)])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className={styles.session}>
      <div className={styles.main}>
        <div className={styles.head}>
          <strong>{title}</strong>
          <span className={styles.path} title={projectPath}>{projectPath}</span>
          <span className={styles.spacer} />
          <span className={styles.badge} data-status={state.status} role="status">
            <span className={styles.dot} data-status={state.status} /> {STATUS_LABEL[state.status]}
          </span>
          {cost !== undefined && <span className={styles.note} title="Cost of the last turn">{formatCost(cost)}</span>}
          {busy && (
            <Button size="small" variant="danger" leadingVisual={SquareFillIcon} disabled={stop.isPending} onClick={interrupt} title="Interrupt the agent (Esc)">
              Stop
            </Button>
          )}
          <Button size="small" variant="invisible" aria-label={changesOpen ? 'Hide changes' : 'Show changes'} aria-pressed={changesOpen} leadingVisual={DiffIcon} onClick={toggleChanges}>
            Changes
          </Button>
          <Button size="small" variant="invisible" aria-label={panel ? 'Hide side panel' : 'Show side panel'} aria-pressed={panel} leadingVisual={SidebarExpandIcon} onClick={() => setPanel(!panel)} />
        </div>
        <div className={styles.scroll} ref={scroller} onScroll={onScroll}>
          {state.items.length === 0 ? (
            <EmptyState title="Start the session">Describe a task. Type / for slash commands and skills, @ to reference a card.</EmptyState>
          ) : (
            <Timeline
              items={state.items}
              approvalBusy={approve.isPending}
              onApproval={(approvalId, reply) => approve.mutate({ approvalId, ...reply })}
              availableCommands={state.slashCommands}
              onShowAgent={showAgent}
              imageSrc={(imageId) => imageUrl(sessionId, imageId)}
              onCommand={(command) => {
                if (send.isPending) return
                setError(null)
                send.mutate(`/${command}`, { onError: (e) => setError(e.message) })
              }}
            />
          )}
          {thinking && <p className={styles.thinking} aria-live="polite">Thinking…</p>}
        </div>
        {(error || approve.isError || stop.isError || permission.isError || unqueue.isError) && (
          <p role="alert" className={styles.error}>{error ?? approve.error?.message ?? stop.error?.message ?? permission.error?.message ?? unqueue.error?.message}</p>
        )}
        {state.queue.length > 0 && (
          <ol className={styles.queue} aria-label="Queued messages">
            {state.queue.map((m) => (
              <li key={m.id}>
                <span className={styles.queueText}>
                  {m.text}
                  {m.images.length > 0 && ` (${m.images.length} image${m.images.length > 1 ? 's' : ''})`}
                </span>
                <Button size="small" variant="invisible" aria-label="Remove queued message" leadingVisual={XIcon} disabled={unqueue.isPending} onClick={() => unqueue.mutate(m.id)} />
              </li>
            ))}
          </ol>
        )}
        <StatusLine projectPath={projectPath} state={state} git={git.data} onMode={changeMode} busy={busy} />
        {attachments.length > 0 && (
          <ul className={styles.attachments} aria-label="Attached images">
            {attachments.map((a, i) => (
              <li key={a.key}>
                <img src={`data:${a.mediaType};base64,${a.data}`} alt={`Attached image ${i + 1}`} />
                <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => setAttachments((all) => all.filter((x) => x.key !== a.key))}>
                  <XIcon size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.composer}>
          {matches.length > 0 && (
            <ul className={styles.suggest} role="listbox" aria-label={slash.length > 0 ? 'Slash commands' : 'Cards'}>
              {matches.map((s, i) => (
                <li key={s.key} role="option" aria-selected={i === pick} data-active={i === pick || undefined} onMouseDown={(e) => { e.preventDefault(); choose(s) }}>
                  {s.label}
                  {s.detail && <span className={styles.suggestDetail}>{s.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          <Textarea
            block
            rows={3}
            aria-label="Message"
            placeholder={busy ? 'The agent is working… Enter queues the message, Esc interrupts' : 'Message the agent; / for commands, @ for cards, paste or drop images'}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setPick(0) }}
            onKeyDown={onKey}
            onPaste={onPaste}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
          <Button variant="primary" onClick={submit} disabled={(!draft.trim() && attachments.length === 0) || send.isPending}>
            {busy ? 'Queue' : 'Send'}
          </Button>
        </div>
      </div>
      {changesOpen && <ChangesPanel sessionId={sessionId} turns={state.turns} />}
      {panel && <SidePanel sessionId={sessionId} tab={sideTab} onTab={chooseTab} agents={state.agents} expanded={expandedAgent} onToggle={(id) => setExpandedAgent(expandedAgent === id ? null : id)} />}
    </div>
  )
}
