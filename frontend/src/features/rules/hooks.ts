import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { Card, DerivedRule, RulesExtraction } from '../../api/types.ts'
import { keys } from '../cards/hooks.ts'

export const rulesKey = (conversationId: number) => ['rules', conversationId] as const
export const rulesWarningKey = (messageId: number) => ['rules-warning', messageId] as const
export const rulesAskedKey = (messageId: number) => ['rules-asked', messageId] as const

export function useRules(conversationId: number) {
  return useQuery({
    queryKey: rulesKey(conversationId),
    queryFn: ({ signal }) => api<DerivedRule[]>(`/api/conversations/${conversationId}/rules`, { signal }),
    retry: false,
  })
}

/** `POST /api/messages/:id/rules`: costs one API call; the warning is kept in the cache for the panel. */
export function useExtractRules(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (messageId: number) => api<RulesExtraction>(`/api/messages/${messageId}/rules`, { method: 'POST' }),
    onSuccess: (data, messageId) => {
      qc.setQueryData(rulesWarningKey(messageId), data.warning ?? null)
      qc.setQueryData(rulesAskedKey(messageId), true)
      return qc.invalidateQueries({ queryKey: rulesKey(conversationId) })
    },
  })
}

export type RulePatch = { status: 'confirmed' | 'rejected' } | { status: 'corrected'; text: string }

export function useDecideRule(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RulePatch }) =>
      api<{ rule: DerivedRule; card?: Card }>(`/api/rules/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: rulesKey(conversationId) }), qc.invalidateQueries({ queryKey: keys.cards })])
    },
  })
}

export function useSaveRuleAsCard(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<{ rule: DerivedRule; card: Card }>(`/api/rules/${id}/card`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: rulesKey(conversationId) }), qc.invalidateQueries({ queryKey: keys.cards })])
    },
  })
}
