import { useState } from 'react'
import { Button, ProgressBar } from '@primer/react'
import { AlertIcon, StopIcon } from '@primer/octicons-react'
import type { Timeline } from '../../api/types.ts'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { ApiError } from '../../api/client.ts'
import { failureText } from '../chat/errors.ts'
import { useTimelineMessages } from '../chat/hooks.ts'
import { useReplayStep } from './hooks.ts'
import styles from './replay.module.css'

type Props = {
  conversationId: number
  timeline: Timeline
  /** An answer of this chat is streaming. */
  busy: boolean
  /** Auto replay progress while its stream runs. */
  progress: { done: number; total: number } | null
  /** Sends the next original prompt (`edit` with the changed text); the chat view streams the answer. */
  onNext: (action: 'send' | 'edit', question: string, content?: string) => void
  onAuto: () => void
  onStop: () => void
}

/** FR-18…FR-20: the replay waits for you; send, edit or skip the next original prompt, branch off or cancel. */
export function ReplayBar({ conversationId, timeline, busy, progress, onNext, onAuto, onStop }: Props) {
  const source = useTimelineMessages(timeline.replaySourceId)
  const step = useReplayStep(conversationId)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const next = (source.data ?? []).find((m) => m.id === timeline.replayNextId)
  const auto = timeline.replayMode === 'auto'
  const run = (kind: 'skip' | 'branch-off' | 'cancel') => step.mutate({ timelineId: timeline.id, kind })
  const disabled = busy || step.isPending

  return (
    <section className={styles.bar} aria-label="Replay">
      <div className={styles.head}>
        <strong>Replay</strong>
        <span className={styles.muted}>
          {timeline.name}
          {timeline.changeSummary ? ` · ${timeline.changeSummary}` : ''} · {auto ? 'automatic' : 'step by step'}
        </span>
      </div>

      {auto && (
        <p className={styles.warn}>
          <AlertIcon size={12} /> Automatic replay sends all remaining prompts. Later prompts may no longer fit the changed answers.
        </p>
      )}

      {busy && progress && (
        <div>
          <ProgressBar aria-label="Replay progress" progress={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0} />
          <p className={styles.muted}>
            {progress.done} of {progress.total} answers done
          </p>
        </div>
      )}

      {!editing && (
        <p className={styles.prompt} aria-label="Next original prompt">
          {next ? (
            <>
              <span className={styles.muted}>Next original prompt</span>
              {next.content}
            </>
          ) : source.isPending ? (
            <span className={styles.muted}>Loading the next prompt…</span>
          ) : (
            <span className={styles.muted}>No prompt left to replay.</span>
          )}
        </p>
      )}
      {editing && (
        <textarea aria-label="Edited prompt" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      )}

      <div className={styles.actions}>
        {auto ? (
          busy ? (
            <Button size="small" variant="danger" leadingVisual={StopIcon} onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button size="small" variant="primary" disabled={disabled || !next} onClick={onAuto}>
              Run all
            </Button>
          )
        ) : editing ? (
          <>
            <Button
              size="small"
              variant="primary"
              disabled={disabled || text.trim() === ''}
              onClick={() => {
                onNext('edit', text.trim(), text.trim())
                setEditing(false)
              }}
            >
              Send edited
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button size="small" variant="primary" disabled={disabled || !next} onClick={() => next && onNext('send', next.content)}>
              Send
            </Button>
            <Button
              size="small"
              disabled={disabled || !next}
              onClick={() => {
                setText(next?.content ?? '')
                setEditing(true)
              }}
            >
              Edit
            </Button>
            <Button size="small" disabled={disabled || !next} onClick={() => run('skip')}>
              Skip
            </Button>
          </>
        )}
        <span className={styles.spacer} />
        <Button size="small" disabled={disabled} onClick={() => run('branch-off')}>
          Branch off
        </Button>
        <Button size="small" variant="danger" disabled={disabled} onClick={() => setConfirmCancel(true)}>
          Cancel replay
        </Button>
      </div>

      {step.isError && (
        <p className={styles.error} role="alert">
          {step.error instanceof ApiError ? failureText(step.error.code, step.error.message) : step.error.message}
        </p>
      )}

      {confirmCancel && (
        <ConfirmDialog title="Cancel the replay?" confirmLabel="Cancel replay" danger onClose={() => setConfirmCancel(false)} onConfirm={() => run('cancel')}>
          The answers so far stay on this timeline; the remaining original prompts are not sent.
        </ConfirmDialog>
      )}
    </section>
  )
}
