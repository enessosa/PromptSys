import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { TimelineComparison } from '../../api/types.ts'

export function useComparison(a: number | null, b: number | null) {
  return useQuery({
    queryKey: ['compare', a, b],
    queryFn: ({ signal }) => api<TimelineComparison>(`/api/timelines/${a}/compare/${b}`, { signal }),
    enabled: a !== null && b !== null && a !== b,
  })
}
