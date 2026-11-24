import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client.ts'
import { eventJson, streamSse } from '../../api/sse.ts'
import type { Citation, ContextItem, MessageStart, MessageStop } from '../../api/types.ts'
import { keys } from '../cards/hooks.ts'
import { chatKeys } from './hooks.ts'

export type StreamState = {
  /** `send` = new question, `regenerate` = new answer for an existing one, `replay` = answers of a replay. */
  kind: 'send' | 'regenerate' | 'replay'
  /** The question shown above the streaming answer. */
  question: string
  /** For regenerate: the answer being replaced (the list hides it while the new one streams). */
  replacesId: number | null
  text: string
  citations: Citation[]
  assistantMessageId: number | null
  droppedCardIds: number[]
  status: 'connecting' | 'streaming'
  /** Auto replay: answers done of the total. */
  progress: { done: number; total: number } | null
}

type Start = { path: string; body: unknown; question: string; kind: StreamState['kind']; replacesId: number | null }

/**
 * Runs one streamed answer at a time. Text and citations are kept locally while streaming;
 * on the end (stop, error or message_stop) the query cache is refreshed and the local state dropped.
 * `start` resolves to the failure (e.g. 424 api_key_missing) or null when the stream was accepted.
 */
export function useChatStream(conversationId: number, options: { onAnswer?: (assistantMessageId: number) => void } = {}) {
  const qc = useQueryClient()
  const [state, setState] = useState<StreamState | null>(null)
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const assistantId = useRef<number | null>(null)
  const mounted = useRef(true)
  const onAnswer = useRef(options.onAnswer)
  useEffect(() => {
    onAnswer.current = options.onAnswer
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      // Leaving the tab must not close the connection (that would stop the answer); only the live view ends.
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) }),
      qc.invalidateQueries({ queryKey: chatKeys.tree(conversationId) }),
      qc.invalidateQueries({ queryKey: ['timeline-messages'] }),
      qc.invalidateQueries({ queryKey: ['context-preview', conversationId] }),
      qc.invalidateQueries({ queryKey: keys.conversations }),
    ])
  }, [qc, conversationId])

  const start = useCallback(
    async ({ path, body, question, kind, replacesId }: Start, onStarted?: () => void): Promise<ApiError | null> => {
      const ctl = new AbortController()
      controller.current = ctl
      assistantId.current = null
      const set = (patch: Partial<StreamState> | ((s: StreamState) => Partial<StreamState>)) =>
        mounted.current && setState((s) => (s ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s))
      setFailure(null)
      setState({ kind, question, replacesId, text: '', citations: [], assistantMessageId: null, droppedCardIds: [], status: 'connecting', progress: null })

      let failed: { code: string; message: string } | null = null
      const finished: number[] = []
      try {
        for await (const ev of streamSse(path, { body, signal: ctl.signal })) {
          if (ev.event === 'message_start') {
            const data = eventJson<MessageStart>(ev)
            assistantId.current = data.assistantMessageId
            onStarted?.()
            // An auto replay streams several answers in one stream: every answer starts with an empty text.
            set({ status: 'streaming', assistantMessageId: data.assistantMessageId, droppedCardIds: data.droppedCardIds, text: '', citations: [] })
          } else if (ev.event === 'text_delta') {
            const { text } = eventJson<{ text: string }>(ev)
            set((s) => ({ text: s.text + text }))
          } else if (ev.event === 'citation') {
            const c = eventJson<Citation>(ev)
            set((s) => ({ citations: [...s.citations, c] }))
          } else if (ev.event === 'message_stop') {
            eventJson<MessageStop>(ev) // validates the payload; used/unused come from the refreshed message
            if (assistantId.current !== null) finished.push(assistantId.current)
          } else if (ev.event === 'progress') {
            set({ progress: eventJson<{ done: number; total: number }>(ev) })
          } else if (ev.event === 'error') {
            failed = eventJson<{ error: { code: string; message: string } }>(ev).error
          }
        }
      } catch (cause) {
        if (cause instanceof ApiError && assistantId.current === null) {
          // Refused before the stream started (424 api_key_missing, 409 generation_running, validation …).
          if (mounted.current) {
            setState(null)
            setFailure({ code: cause.code, message: cause.message })
          }
          return cause
        }
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          failed = { code: 'network_error', message: 'The connection to the backend was lost.' }
        }
      }

      await refresh()
      if (mounted.current) {
        setState(null)
        setFailure(failed)
      }
      for (const id of finished) onAnswer.current?.(id)
      return null
    },
    [refresh],
  )

  const send = useCallback(
    (timelineId: number, content: string, cards: ContextItem[] | null, onStarted?: () => void) =>
      start(
        { path: `/api/timelines/${timelineId}/messages`, body: { content, ...(cards ? { cards } : {}) }, question: content, kind: 'send', replacesId: null },
        onStarted,
      ),
    [start],
  )

  const regenerate = useCallback(
    (messageId: number, excludeCardIds: number[], question: string) =>
      start({ path: `/api/messages/${messageId}/regenerate`, body: { excludeCardIds }, question, kind: 'regenerate', replacesId: messageId }),
    [start],
  )

  /** Replay step: `send` the original prompt, `edit` it (needs `content`). `skip` is a plain request, see ReplayBar. */
  const replayNext = useCallback(
    (timelineId: number, action: 'send' | 'edit', question: string, content?: string) =>
      start({ path: `/api/replays/${timelineId}/next`, body: { action, ...(content !== undefined ? { content } : {}) }, question, kind: 'replay', replacesId: null }),
    [start],
  )

  /** Auto replay: all remaining prompts in one stream. */
  const replayAuto = useCallback(
    (timelineId: number) => start({ path: `/api/replays/${timelineId}/auto`, body: {}, question: '', kind: 'replay', replacesId: null }),
    [start],
  )

  const stop = useCallback(async () => {
    const id = assistantId.current
    if (id === null) {
      controller.current?.abort()
      return
    }
    try {
      await api(`/api/messages/${id}/stop`, { method: 'POST' })
    } catch {
      controller.current?.abort()
    }
  }, [])

  return { state, failure, send, regenerate, replayNext, replayAuto, stop, busy: state !== null }
}
