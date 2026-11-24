import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client.ts'
import type {
  Card,
  CardKind,
  CardSummary,
  CardVersion,
  Conversation,
  CreateCardInput,
  Link,
  LinkKind,
  SearchResult,
  UpdateCardInput,
} from '../../api/types.ts'

export const keys = {
  cards: ['cards'] as const,
  card: (id: number) => ['card', id] as const,
  versions: (id: number) => ['card', id, 'versions'] as const,
  graph: ['graph'] as const,
  conversations: ['conversations'] as const,
}

export type CardListParams = { query?: string; kind?: CardKind; folder?: string }

export function useCards(params: CardListParams = {}) {
  return useQuery({
    queryKey: [...keys.cards, params],
    queryFn: ({ signal }) => api<CardSummary[]>('/api/cards', { query: params, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useCard(id: number | undefined) {
  return useQuery({
    queryKey: keys.card(id ?? 0),
    queryFn: ({ signal }) => api<Card>(`/api/cards/${id}`, { signal }),
    enabled: id !== undefined,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
}

export function useCardVersions(id: number, enabled: boolean) {
  return useQuery({
    queryKey: keys.versions(id),
    queryFn: ({ signal }) => api<CardVersion[]>(`/api/cards/${id}/versions`, { signal }),
    enabled,
  })
}

/** Conversations are built by another feature; a missing endpoint just means "none yet". */
export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: async ({ signal }) => {
      try {
        return await api<Conversation[]>('/api/conversations', { signal })
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501)) return []
        throw e
      }
    },
  })
}

/** Palette search: `/api/search` when the backend has it, otherwise the card list. */
export async function searchEverything(q: string, signal?: AbortSignal): Promise<SearchResult> {
  try {
    return await api<SearchResult>('/api/search', { query: { q }, signal })
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 404 || e.status === 405))) throw e
    const cards = await api<CardSummary[]>('/api/cards', { query: { query: q }, signal })
    return { cards, conversations: [] }
  }
}

function useInvalidateCards() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.cards }),
      qc.invalidateQueries({ queryKey: ['card'] }),
      qc.invalidateQueries({ queryKey: keys.graph }),
    ])
}

export function useCreateCard() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: (input: CreateCardInput) => api<Card>('/api/cards', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useUploadCard() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: ({ file, folderPath }: { file: File; folderPath?: string }) => {
      const form = new FormData()
      form.set('file', file)
      if (folderPath) form.set('folderPath', folderPath)
      return api<Card>('/api/cards/upload', { method: 'POST', form })
    },
    onSuccess: invalidate,
  })
}

export function useUpdateCard() {
  const qc = useQueryClient()
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateCardInput & { id: number }) =>
      api<Card>(`/api/cards/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (card) => {
      qc.setQueryData(keys.card(card.id), card)
      void qc.invalidateQueries({ queryKey: keys.versions(card.id) })
      return invalidate()
    },
  })
}

export function useArchiveCard() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: (id: number) => api(`/api/cards/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useCreateLink() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: (input: { sourceId: number; targetId: number; kind?: LinkKind; label?: string | null }) =>
      api<Link>('/api/links', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useUpdateLink() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; kind?: LinkKind; label?: string | null }) =>
      api<Link>(`/api/links/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: invalidate,
  })
}

export function useDeleteLink() {
  const invalidate = useInvalidateCards()
  return useMutation({
    mutationFn: (id: number) => api(`/api/links/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
