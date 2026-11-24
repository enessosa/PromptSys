import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Checkbox } from '@primer/react'
import { AlertIcon, GitBranchIcon, StopIcon } from '@primer/octicons-react'
import { api, ApiError } from '../../api/client.ts'
import type { ChatMessage } from '../../api/types.ts'
import { EmptyState } from '../../components/EmptyState.tsx'
import { ApiKeyButton } from '../settings/ApiKeyButton.tsx'
import { RulesPanel } from '../rules/RulesPanel.tsx'
import { useExtractRules } from '../rules/hooks.ts'
import { ReplayBar } from '../replay/ReplayBar.tsx'
import { ReplaySetup } from '../replay/ReplaySetup.tsx'
import { useWorkspace } from '../../state/workspace.ts'
import { ContextTray } from './ContextTray.tsx'
import { errorText } from './errors.ts'
import { AssistantText, MessageView } from './MessageView.tsx'
import { RegenerateDialog } from './RegenerateDialog.tsx'
import { chatKeys, useConversation, useHealth, useTimelineMessages, useTree } from './hooks.ts'
import { keys } from '../cards/hooks.ts'
import { useChatStream } from './useChatStream.ts'
import styles from './chat.module.css'

export const NO_API_KEY_TEXT =
  'No API key configured. Set ANTHROPIC_API_KEY in backend/.env and restart the backend; until then chat is unavailable.'

export function ChatView({ conversationId }: { conversationId: number }) {
  const { data: conversation, isPending, error } = useConversation(conversationId)
  if (isPending) return <EmptyState title="Loading…" />
  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return <EmptyState title={missing ? 'This conversation does not exist' : 'Conversation could not be loaded'}>{error.message}</EmptyState>
  }
  return <ChatBody key={conversation.id} conversationId={conversationId} timelineId={conversation.activeTimelineId ?? null} title={conversation.title} showRules={conversation.showDerivedRules === true} />
}

function ChatBody({ conversationId, timelineId, title, showRules }: { conversationId: number; timelineId: number | null; title: string; showRules: boolean }) {
  const health = useHealth()
  const messages = useTimelineMessages(timelineId)
  const tree = useTree(conversationId)
  const extract = useExtractRules(conversationId)
  const { mutate: extractRules } = extract
  const showRulesRef = useRef(showRules)
  useEffect(() => {
    showRulesRef.current = showRules
  })
  // FR-15: one extra API call after each finished answer, only while the toggle is on.
  const stream = useChatStream(conversationId, { onAnswer: (id) => showRulesRef.current && extractRules(id) })
  const qc = useQueryClient()
  const toggleRules = useMutation({
    mutationFn: (on: boolean) => api(`/api/conversations/${conversationId}`, { method: 'PATCH', body: { showDerivedRules: on } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) }), qc.invalidateQueries({ queryKey: keys.conversations })]),
  })
  const [branchFrom, setBranchFrom] = useState<ChatMessage | null>(null)
  const selectedId = useWorkspace((s) => s.selectedMessageId)
  const setSelected = useWorkspace((s) => s.setSelectedMessage)
  const resetContext = useWorkspace((s) => s.resetChatContext)
  const [draft, setDraft] = useState('')
  const [regen, setRegen] = useState<ChatMessage | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(null)
    return () => setSelected(null)
  }, [conversationId, setSelected])

  const all = messages.data ?? []
  const { state, failure } = stream
  const noKey = health.data?.apiKeyConfigured === false || failure?.code === 'api_key_missing'

  // While a regenerated answer streams, the answer it replaces (and what follows) is hidden.
  let shown = all
  if (state?.replacesId != null) {
    const target = all.find((m) => m.id === state.replacesId)
    const cut = target ? all.findIndex((m) => m.id === target.parentId) : -1
    shown = cut >= 0 ? all.slice(0, cut) : all
  }
  const orphan = !state ? all.find((m) => m.role === 'assistant' && m.status === 'streaming') : undefined
  const busy = stream.busy || orphan !== undefined

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown.length, state?.text])

  const branch = tree.data?.timelines.find((t) => t.id === timelineId)
  const replay = branch && (branch.replayStatus === 'paused' || branch.replayStatus === 'running') ? branch : null
  const branchLabel = branch && branch.parentTimelineId !== null ? [branch.name, branch.changeSummary].filter(Boolean).join(' · ') : null

  const submit = async () => {
    const content = draft.trim()
    if (!content || busy || timelineId === null || noKey || replay) return
    const cards = useWorkspace.getState().chatContexts[conversationId]?.items ?? null
    await stream.send(timelineId, content, cards, () => {
      setDraft('')
      resetContext(conversationId)
    })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const stop = () => {
    if (orphan) void api(`/api/messages/${orphan.id}/stop`, { method: 'POST' }).catch(() => undefined)
    else void stream.stop()
  }

  const lastAnswer = [...all].reverse().find((m) => m.role === 'assistant')
  const regenTarget = regen ?? null
  const regenContext = regenTarget ? (all.find((m) => m.id === regenTarget.parentId)?.context ?? []) : []

  return (
    <div className={styles.chat}>
      <div className={styles.chatHead}>
        <strong>{title}</strong>
        {branchLabel && <span className={styles.branchTag}>Branch: {branchLabel}</span>}
        <span className={styles.spacer} />
        {extract.isPending && <span className={styles.branchTag}>Extracting rules…</span>}
        <label className={styles.rulesToggle} title="Costs one extra API call per answer">
          <Checkbox checked={showRules} disabled={toggleRules.isPending} onChange={(e) => toggleRules.mutate(e.target.checked)} aria-label="Show derived rules" />
          Show derived rules
        </label>
      </div>
      <div className={styles.messages} ref={scroller} aria-label="Messages">
        {messages.isError && <p className={styles.noteError} role="alert">{messages.error.message}</p>}
        {shown.length === 0 && !state && !messages.isPending && (
          <EmptyState title="Ask something">
            The cards in the tray below are sent as context. The model cites them as [c1], [c2] …
          </EmptyState>
        )}
        {shown.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            selected={m.role === 'assistant' && (selectedId ?? lastAnswer?.id) === m.id}
            busy={busy}
            onSelect={m.role === 'assistant' ? () => setSelected(m.id) : undefined}
            onRegenerate={m.role === 'assistant' && m.status !== 'streaming' ? () => setRegen(m) : undefined}
            sentCards={m.role === 'assistant' ? (all.find((x) => x.id === m.parentId)?.context ?? undefined) : undefined}
            extraActions={
              m.status !== 'streaming' && !busy ? (
                <Button size="small" variant="invisible" leadingVisual={GitBranchIcon} onClick={() => setBranchFrom(m)}>
                  Branch from here
                </Button>
              ) : undefined
            }
            below={m.role === 'assistant' && showRules && m.status === 'complete' ? <RulesPanel conversationId={conversationId} messageId={m.id} /> : undefined}
          />
        ))}
        {state && (
          <>
            {state.question && (
              <article className={styles.message} data-role="user" aria-label="Your message">
                <div className={styles.userText}>{state.question}</div>
              </article>
            )}
            <article className={styles.message} data-role="assistant" aria-label="Answer" aria-busy>
              {state.text ? <AssistantText text={state.text} citations={state.citations} /> : <p className={styles.note}>Waiting for the model…</p>}
            </article>
          </>
        )}
      </div>

      {noKey && (
        <div className={styles.banner} role="alert">
          <AlertIcon size={14} /> {NO_API_KEY_TEXT} <ApiKeyButton variant="primary" size="small" />
        </div>
      )}
      {failure && failure.code !== 'api_key_missing' && (
        <div className={styles.banner} role="alert">
          <AlertIcon size={14} /> {errorText(failure.code) === `Error: ${failure.code}` ? failure.message : errorText(failure.code)}
        </div>
      )}

      {extract.isError && (
        <div className={styles.banner} role="alert">
          <AlertIcon size={14} /> Derived rules could not be extracted: {extract.error.message}
        </div>
      )}

      {replay && (
        <ReplayBar
          conversationId={conversationId}
          timeline={replay}
          busy={busy}
          progress={state?.progress ?? null}
          onNext={(action, question, content) => void stream.replayNext(replay.id, action, question, content)}
          onAuto={() => void stream.replayAuto(replay.id)}
          onStop={stop}
        />
      )}

      <ContextTray conversationId={conversationId} timelineId={timelineId} draft={draft} />

      <div className={styles.composer}>
        <textarea
          aria-label="Message"
          placeholder={noKey ? 'Chat is unavailable without an API key' : replay ? 'A replay is active: use the replay bar, branch off or cancel to chat freely' : 'Ask a question (Enter sends, Shift+Enter for a new line)'}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {busy ? (
          <Button leadingVisual={StopIcon} onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void submit()} disabled={!draft.trim() || timelineId === null || noKey || replay !== null}>
            Send
          </Button>
        )}
      </div>

      {branchFrom && (
        <ReplaySetup
          conversationId={conversationId}
          message={branchFrom}
          base={(branchFrom.role === 'user' ? branchFrom.context : all.find((x) => x.id === branchFrom.parentId)?.context) ?? []}
          sourceTimelineId={timelineId}
          onClose={() => setBranchFrom(null)}
        />
      )}

      {regenTarget && (
        <RegenerateDialog
          cards={regenContext}
          onClose={() => setRegen(null)}
          onSubmit={(ids) => {
            const question = all.find((m) => m.id === regenTarget.parentId)?.content ?? ''
            void stream.regenerate(regenTarget.id, ids, question)
          }}
        />
      )}
    </div>
  )
}
