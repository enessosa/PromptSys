import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client.ts'
import { eventJson, subscribeSse } from '../../api/sse.ts'
import type { AppMode, CodeSession, PlanUsage, CodeSessionDetail, CodeStatus, GitInfo, PermissionMode, SessionCard, SessionChanges } from '../../api/types.ts'
import { keys } from '../cards/hooks.ts'
import { useSaveSettings, useSettings } from '../settings/hooks.ts'
import { applyEvent, emptyState, fromRecord, replay, type CodeEvent, type SessionState } from './model.ts'

export const codeKeys = {
  status: ['code', 'status'] as const,
  sessions: ['code', 'sessions'] as const,
  session: (id: number) => ['code', 'session', id] as const,
  cards: (id: number) => ['code', 'session', id, 'cards'] as const,
  git: (id: number) => ['code', 'session', id, 'git'] as const,
  changes: (id: number) => ['code', 'session', id, 'changes'] as const,
  planUsage: ['code', 'plan-usage'] as const,
}

/** Current mode (`api` until the settings are loaded) and whether the API-call features are locked. */
export function useMode(): { mode: AppMode; claudeCode: boolean } {
  const mode = useSettings().data?.mode ?? 'api'
  return { mode, claudeCode: mode === 'claude_code' }
}

export function useSetMode() {
  const save = useSaveSettings()
  const qc = useQueryClient()
  return {
    ...save,
    setMode: (mode: AppMode) =>
      save.mutate({ mode }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['code'] }) }),
  }
}

export function useCodeStatus(enabled = true) {
  return useQuery({
    queryKey: codeKeys.status,
    queryFn: ({ signal }) => api<CodeStatus>('/api/code/status', { signal }),
    enabled,
    staleTime: 30_000,
  })
}

/** Plan limits (5-hour / 7-day) of the account: one value for all sessions, refreshed when any session reports new numbers. */
export function usePlanUsage(enabled = true) {
  return useQuery({
    queryKey: codeKeys.planUsage,
    queryFn: ({ signal }) => api<PlanUsage | null>('/api/code/plan-usage', { signal }),
    enabled,
    retry: false,
  })
}

export function useCodeSessions(enabled = true) {
  return useQuery({
    queryKey: codeKeys.sessions,
    queryFn: ({ signal }) => api<CodeSession[]>('/api/code/sessions', { signal }),
    enabled,
    retry: false,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { projectPath: string; title?: string }) => api<CodeSession>('/api/code/sessions', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: codeKeys.sessions }),
  })
}

export function useRenameSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) => api<CodeSession>(`/api/code/sessions/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: codeKeys.sessions }),
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api(`/api/code/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: codeKeys.sessions }),
  })
}

export function useSendMessage(sessionId: number) {
  return useMutation({ mutationFn: (text: string) => api(`/api/code/sessions/${sessionId}/messages`, { method: 'POST', body: { text } }) })
}

export function useResolveApproval(sessionId: number) {
  return useMutation({
    mutationFn: ({ approvalId, allow }: { approvalId: string; allow: boolean }) =>
      api(`/api/code/sessions/${sessionId}/approvals/${approvalId}`, { method: 'POST', body: { allow } }),
  })
}

export function useSetPermissionMode(sessionId: number) {
  return useMutation({
    mutationFn: (permissionMode: PermissionMode) => api<CodeSession>(`/api/code/sessions/${sessionId}`, { method: 'PATCH', body: { permissionMode } }),
  })
}

/** Branch and dirty flag of the project; reloaded after every finished turn (`turns`). */
export function useGitInfo(sessionId: number, turns: number) {
  return useQuery({
    queryKey: [...codeKeys.git(sessionId), turns],
    queryFn: ({ signal }) => api<GitInfo>(`/api/code/sessions/${sessionId}/git`, { signal }),
    retry: false,
    placeholderData: keepPreviousData,
  })
}

/** Uncommitted changes of the project; only loaded while the panel is open, and again after every finished turn. */
export function useChanges(sessionId: number, turns: number, enabled: boolean) {
  return useQuery({
    queryKey: [...codeKeys.changes(sessionId), turns],
    queryFn: ({ signal }) => api<SessionChanges>(`/api/code/sessions/${sessionId}/changes`, { signal }),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useStopSession(sessionId: number) {
  return useMutation({ mutationFn: () => api(`/api/code/sessions/${sessionId}/stop`, { method: 'POST' }) })
}

export function useSessionCards(sessionId: number) {
  return useQuery({
    queryKey: codeKeys.cards(sessionId),
    queryFn: ({ signal }) => api<SessionCard[]>(`/api/code/sessions/${sessionId}/cards`, { signal }),
    retry: false,
  })
}

export function useReviewCard(sessionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; reviewStatus?: 'confirmed' | 'rejected'; title?: string; body?: string }) =>
      api(`/api/code/cards/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: codeKeys.cards(sessionId) }),
        qc.invalidateQueries({ queryKey: keys.cards }),
        qc.invalidateQueries({ queryKey: keys.graph }),
      ]),
  })
}

const RECONNECT_MS = 2000

/**
 * Loads the session history, then follows the live stream. Both feed the same reducer, which
 * ignores events with a `seq` it has already seen, so the overlap and reconnects are harmless.
 */
export function useCodeSession(sessionId: number) {
  const qc = useQueryClient()
  const detail = useQuery({
    queryKey: codeKeys.session(sessionId),
    queryFn: ({ signal }) => api<CodeSessionDetail>(`/api/code/sessions/${sessionId}`, { signal }),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  })
  const data = detail.data
  // History as a state; live events continue from it (the first one takes it over).
  const seed = useMemo(() => (data ? replay(data.events.map(fromRecord), emptyState(data.session.status, data.slashCommands, data.session.permissionMode)) : emptyState()), [data])
  // Live state belongs to one session: the view is reused when the user switches between session tabs, and a state left over
  // from another session (e.g. "running") must not show here.
  const [live, setLiveFor] = useState<{ sessionId: number; state: SessionState } | null>(null)
  const current = live?.sessionId === sessionId ? live.state : null
  const state = current ?? seed
  const setLive = (update: (s: SessionState | null) => SessionState) =>
    setLiveFor((prev) => ({ sessionId, state: update(prev?.sessionId === sessionId ? prev.state : null) }))

  useEffect(() => {
    if (!data) return
    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        for await (const ev of subscribeSse(`/api/code/sessions/${sessionId}/stream`, { signal: ctl.signal })) {
          const payload = eventJson<Record<string, unknown>>(ev)
          const event = { ...payload, type: ev.event, seq: Number(payload.seq) } as CodeEvent
          setLiveFor((prev) => ({ sessionId, state: applyEvent(prev?.sessionId === sessionId ? prev.state : seed, event) }))
          if (ev.event === 'status' || ev.event === 'result') void qc.invalidateQueries({ queryKey: codeKeys.sessions })
          if (ev.event === 'plan_usage') void qc.invalidateQueries({ queryKey: codeKeys.planUsage })
          if (ev.event === 'card') {
            void qc.invalidateQueries({ queryKey: codeKeys.cards(sessionId) })
            void qc.invalidateQueries({ queryKey: keys.cards })
            void qc.invalidateQueries({ queryKey: keys.graph })
          }
        }
      } catch (cause) {
        if (ctl.signal.aborted || (cause instanceof ApiError && cause.status >= 400 && cause.status < 500)) return
      }
      if (!ctl.signal.aborted) timer = setTimeout(() => void run(), RECONNECT_MS)
    }
    void run()
    return () => {
      ctl.abort()
      clearTimeout(timer)
    }
  }, [data, seed, sessionId, qc])

  /** Shows a mode change at once; the `mode` event from the stream confirms it (and updates other tabs). */
  const setMode = (permissionMode: PermissionMode) => setLive((s) => ({ ...(s ?? seed), permissionMode }))

  return { detail, state, setMode }
}
