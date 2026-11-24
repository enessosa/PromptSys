import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, isBackendDown } from '../../api/client.ts'
import type {
  ChatMessage,
  Conversation,
  ContextItem,
  ContextPreview,
  ConversationTree,
} from '../../api/types.ts'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { keys } from '../cards/hooks.ts'

export const chatKeys = {
  conversation: (id: number) => ['conversation', id] as const,
  tree: (id: number) => ['tree', id] as const,
  messages: (timelineId: number) => ['timeline-messages', timelineId] as const,
  preview: (conversationId: number, timelineId: number, cards: ContextItem[] | null) =>
    ['context-preview', conversationId, timelineId, cards] as const,
}

export type Health = { status: string; apiKeyConfigured: boolean }

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api<Health>('/api/health', { signal }),
    // While the backend is down, poll quickly so the UI recovers as soon as it is back.
    refetchInterval: (q) => (q.state.status === 'error' ? 3000 : 30000),
    retry: false,
  })
}

/** True while the health check cannot reach the backend. */
export function useBackendDown(): boolean {
  const health = useHealth()
  return health.isError && isBackendDown(health.error)
}

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: chatKeys.conversation(id ?? 0),
    queryFn: ({ signal }) => api<Conversation>(`/api/conversations/${id}`, { signal }),
    enabled: id !== null,
  })
}

export function useTree(conversationId: number) {
  return useQuery({
    queryKey: chatKeys.tree(conversationId),
    queryFn: ({ signal }) => api<ConversationTree>(`/api/conversations/${conversationId}/tree`, { signal }),
  })
}

export function useTimelineMessages(timelineId: number | null | undefined) {
  return useQuery({
    queryKey: chatKeys.messages(timelineId ?? 0),
    queryFn: ({ signal }) => api<ChatMessage[]>(`/api/timelines/${timelineId}/messages`, { signal }),
    enabled: timelineId != null,
    // An answer that is still streaming (e.g. after switching tabs) is polled until it is saved.
    refetchInterval: (q) => (q.state.data?.some((m) => m.status === 'streaming') ? 1500 : false),
  })
}

/** `cards` null = backend default (carry-forward); otherwise the complete state the user negotiated. */
export function useContextPreview(
  conversationId: number,
  timelineId: number | null | undefined,
  cards: ContextItem[] | null,
  options: { content?: string; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: options.content === undefined ? chatKeys.preview(conversationId, timelineId ?? 0, cards) : [...chatKeys.preview(conversationId, timelineId ?? 0, cards), options.content],
    queryFn: ({ signal }) =>
      api<ContextPreview>(`/api/conversations/${conversationId}/context-preview`, {
        method: 'POST',
        body: { timelineId, ...(options.content ? { content: options.content } : {}), ...(cards ? { cards } : {}) },
        signal,
      }),
    enabled: timelineId != null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  })
}

export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<Conversation>('/api/conversations', { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  })
}

function useInvalidateConversation() {
  const qc = useQueryClient()
  return (id: number) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.conversations }),
      qc.invalidateQueries({ queryKey: chatKeys.conversation(id) }),
      qc.invalidateQueries({ queryKey: chatKeys.tree(id) }),
    ])
}

export function useRenameConversation() {
  const invalidate = useInvalidateConversation()
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: (_c, { id }) => invalidate(id),
  })
}

export function useSetActiveTimeline() {
  const invalidate = useInvalidateConversation()
  return useMutation({
    mutationFn: ({ id, timelineId }: { id: number; timelineId: number }) =>
      api<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: { activeTimelineId: timelineId } }),
    onSuccess: (_c, { id }) => invalidate(id),
  })
}

export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api(`/api/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  })
}

/** Creates a conversation and opens it as a chat tab (button, palette command and shortcut share this). */
export function useNewConversation() {
  const { mutate } = useCreateConversation()
  const openTab = useWorkspace((s) => s.openTab)
  return () => mutate(undefined, { onSuccess: (c) => openTab(makeTab('chat', c.id)) })
}
