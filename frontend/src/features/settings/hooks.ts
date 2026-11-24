import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { Settings } from '../../api/types.ts'

export const settingsKey = ['settings'] as const

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => api<Settings>('/api/settings', { signal }),
    staleTime: 30_000,
  })
}

/** PUT merges the given fields and answers with all settings. */
export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api<Settings>('/api/settings', { method: 'PUT', body: patch }),
    onSuccess: (data) => qc.setQueryData(settingsKey, data),
  })
}
