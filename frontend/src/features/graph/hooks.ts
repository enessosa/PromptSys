import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { GraphDto, MergePreview, MergeResult, NodePosition, UndoMergeResult } from '../../api/types.ts'
import { keys } from '../cards/hooks.ts'

export function useGraph() {
  return useQuery({
    queryKey: keys.graph,
    queryFn: ({ signal }) => api<GraphDto>('/api/graph', { signal }),
  })
}

/** Persists node positions and patches the cached graph, so no refetch (and no jump) is needed. */
export function useSavePositions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (positions: NodePosition[]) => api('/api/graph/positions', { method: 'PUT', body: { positions } }),
    onSuccess: (_void, positions) => {
      const byId = new Map(positions.map((p) => [p.id, p]))
      qc.setQueryData<GraphDto>(keys.graph, (old) =>
        old
          ? { ...old, nodes: old.nodes.map((n) => (byId.has(n.id) ? { ...n, x: byId.get(n.id)!.x, y: byId.get(n.id)!.y } : n)) }
          : old,
      )
    },
  })
}

export function useMergePreview(targetId: number, sourceIds: number[]) {
  return useQuery({
    queryKey: ['merge-preview', targetId, sourceIds],
    queryFn: ({ signal }) =>
      api<MergePreview>('/api/merges/preview', { method: 'POST', body: { targetId, sourceIds }, signal }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

function useInvalidateAfterMerge() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.cards }),
      qc.invalidateQueries({ queryKey: ['card'] }),
      qc.invalidateQueries({ queryKey: keys.graph }),
    ])
}

export function useMerge() {
  const invalidate = useInvalidateAfterMerge()
  return useMutation({
    mutationFn: (input: { targetId: number; sourceIds: number[]; title: string; body: string }) =>
      api<MergeResult>('/api/merges', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useUndoMerge() {
  const invalidate = useInvalidateAfterMerge()
  return useMutation({
    mutationFn: (mergeId: number) => api<UndoMergeResult>(`/api/merges/${mergeId}/undo`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}
