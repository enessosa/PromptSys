import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client.ts'
import { eventJson, streamSse } from '../../api/sse.ts'
import type { AblationCardResult, AblationDryRun, AblationResults } from '../../api/types.ts'

export const ablationKey = (messageId: number) => ['ablations', messageId] as const

/** Stored results of an answer; a missing endpoint or answer just means "no results". */
export function useAblations(messageId: number, enabled = true) {
  return useQuery({
    queryKey: ablationKey(messageId),
    queryFn: ({ signal }) => api<AblationResults>(`/api/messages/${messageId}/ablations`, { signal }),
    enabled,
    retry: false,
  })
}

export type AblationRequest = { cardIds: number[]; runs: number; baselineRuns: number }

export type AblationProgress = { done: number; total: number }

/** Dry run (FR-21) and the streamed run of an ablation. */
export function useAblationRun(messageId: number) {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<AblationProgress | null>(null)
  const [results, setResults] = useState<AblationCardResult[]>([])
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)

  const dryRun = useCallback(
    (req: AblationRequest) => api<AblationDryRun>(`/api/messages/${messageId}/ablations`, { method: 'POST', body: { ...req, dryRun: true } }),
    [messageId],
  )

  /** Resolves to an error (refusal or stream error) or null on success. */
  const run = useCallback(
    async (req: AblationRequest): Promise<{ code: string; message: string } | null> => {
      const ctl = new AbortController()
      controller.current = ctl
      setRunning(true)
      setResults([])
      setProgress({ done: 0, total: 0 })
      let failure: { code: string; message: string } | null = null
      try {
        for await (const ev of streamSse(`/api/messages/${messageId}/ablations`, { body: req, signal: ctl.signal })) {
          if (ev.event === 'progress') setProgress(eventJson<AblationProgress>(ev))
          else if (ev.event === 'ablation_result') {
            const r = eventJson<AblationCardResult>(ev)
            setResults((prev) => [...prev.filter((x) => x.cardId !== r.cardId), r])
          } else if (ev.event === 'error') failure = eventJson<{ error: { code: string; message: string } }>(ev).error
        }
      } catch (cause) {
        if (cause instanceof ApiError) failure = { code: cause.code, message: cause.message }
        else if (!(cause instanceof DOMException && cause.name === 'AbortError')) failure = { code: 'network_error', message: 'The connection to the backend was lost.' }
      }
      setRunning(false)
      await qc.invalidateQueries({ queryKey: ablationKey(messageId) })
      return failure
    },
    [messageId, qc],
  )

  const cancel = useCallback(() => controller.current?.abort(), [])
  return { dryRun, run, cancel, progress, results, running }
}
