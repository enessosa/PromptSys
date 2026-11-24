import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { ContextChanges, ReplayMode, ReplayRequest, ReplayResponse, Timeline } from '../../api/types.ts'
import { keys } from '../cards/hooks.ts'
import { chatKeys } from '../chat/hooks.ts'

function useRefresh(conversationId: number) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) }),
      qc.invalidateQueries({ queryKey: chatKeys.tree(conversationId) }),
      qc.invalidateQueries({ queryKey: ['timeline-messages'] }),
      qc.invalidateQueries({ queryKey: keys.conversations }),
      qc.invalidateQueries({ queryKey: keys.cards }),
    ])
}

export type ReplayInput = { fromMessageId: number; contextChanges: ContextChanges; mode: ReplayMode; sourceTimelineId?: number }

const body = (i: ReplayInput, dryRun: boolean): ReplayRequest => ({
  fromMessageId: i.fromMessageId,
  contextChanges: i.contextChanges,
  mode: i.mode,
  dryRun,
  ...(i.sourceTimelineId !== undefined ? { sourceTimelineId: i.sourceTimelineId } : {}),
})

/** FR-21: the dry run creates nothing and reports the pending prompts and the number of API calls. */
export function useReplayDryRun() {
  return useMutation({ mutationFn: (i: ReplayInput) => api<ReplayResponse>('/api/replays', { method: 'POST', body: body(i, true) }) })
}

export function useCreateReplay(conversationId: number) {
  const refresh = useRefresh(conversationId)
  return useMutation({
    mutationFn: (i: ReplayInput) => api<ReplayResponse>('/api/replays', { method: 'POST', body: body(i, false) }),
    onSuccess: () => refresh(),
  })
}

export function useReplayStep(conversationId: number) {
  const refresh = useRefresh(conversationId)
  return useMutation({
    mutationFn: ({ timelineId, kind }: { timelineId: number; kind: 'skip' | 'branch-off' | 'cancel' }) =>
      kind === 'skip'
        ? api<{ timeline: Timeline }>(`/api/replays/${timelineId}/next`, { method: 'POST', body: { action: 'skip' } })
        : api<{ timeline: Timeline }>(`/api/replays/${timelineId}/${kind}`, { method: 'POST', body: {} }),
    // After 409 replay_not_active the bar must see the real state.
    onSettled: () => refresh(),
  })
}
