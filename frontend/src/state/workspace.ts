import { create } from 'zustand'
import type { CardState, ContextItem, MergeResult } from '../api/types.ts'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export type TabType = 'card' | 'graph' | 'chat' | 'branches' | 'settings' | 'code'

export type Tab = {
  /** Stable key: `card:3`, `graph`, `chat:5`, `branches:5`, `code:2`, `settings`. */
  id: string
  type: TabType
  refId?: number
  /** Preview tabs (italic) are replaced by the next preview opened in the same pane. */
  preview?: boolean
}

export type Pane = { tabs: Tab[]; activeTabId: string | null }

export const MAX_PANES = 2

export function tabKey(type: TabType, refId?: number): string {
  return refId === undefined ? type : `${type}:${refId}`
}

export function makeTab(type: TabType, refId?: number): Tab {
  return { id: tabKey(type, refId), type, refId }
}

export function tabPath(tab: Tab): string {
  return tab.refId === undefined ? `/${tab.type}` : `/${tab.type}/${tab.refId}`
}

/** URL path → tab; null for paths that are no tab (`/`, unknown, non-numeric ids). */
export function pathToTab(pathname: string): Tab | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 1 && parts[0] === 'graph') return makeTab('graph')
  if (parts.length === 1 && parts[0] === 'settings') return makeTab('settings')
  if (parts.length === 2 && (parts[0] === 'card' || parts[0] === 'chat' || parts[0] === 'branches' || parts[0] === 'code') && /^\d+$/.test(parts[1])) {
    return makeTab(parts[0], Number(parts[1]))
  }
  return null
}

/** Context state of a chat as the tray shows it (and sends it). `custom` = changed by the user, not the backend default. */
export type ChatContext = { items: ContextItem[]; custom: boolean; tokens: number | null }

/** Request to open the "Why?" dialog: the answer, the cards it can be asked about and the preselected one. */
export type WhyTarget = {
  messageId: number
  answerText: string
  cards: { cardId: number; title: string }[]
  cardId: number
}

export type OpenOptions = { pane?: number; preview?: boolean }

export type WorkspaceState = {
  panes: Pane[]
  activePane: number
  sidebarOpen: boolean
  inspectorOpen: boolean
  paletteOpen: boolean
  /** Card ids selected in the graph (read by the "Merge selected" command). */
  graphSelection: number[]
  /** Cards of the open merge dialog (first = default survivor); null = closed. */
  mergeIds: number[] | null
  /** Last completed merge; drives the Undo toast. */
  lastMerge: MergeResult | null
  /** Context tray state per conversation (not persisted); the graph highlights the one of `lastChatId`. */
  chatContexts: Record<number, ChatContext>
  lastChatId: number | null
  /** Message selected in the active chat (shown in the inspector); null = latest answer. */
  selectedMessageId: number | null
  /** Short message for the notice toast. */
  notice: string | null
  /** Open "Why?" dialog; null = closed. */
  why: WhyTarget | null
  /** API calls of an ablation or replay that is being prepared (status bar); null = none. */
  expectedCalls: number | null

  openTab: (tab: Tab, options?: OpenOptions) => void
  closeTab: (tabId: string) => void
  closeActiveTab: () => void
  activateTab: (tabId: string) => void
  setActivePane: (pane: number) => void
  toggleSidebar: () => void
  toggleInspector: () => void
  setPaletteOpen: (open: boolean) => void
  setGraphSelection: (ids: number[]) => void
  openMerge: (ids: number[]) => void
  closeMerge: () => void
  setLastMerge: (merge: MergeResult | null) => void
  /** The tray reports the state it got from the backend (ignored while the user has a custom state). */
  syncChatContext: (conversationId: number, items: ContextItem[], tokens: number | null) => void
  setChatTokens: (conversationId: number, tokens: number | null) => void
  editChatContext: (conversationId: number, items: ContextItem[]) => void
  resetChatContext: (conversationId: number) => void
  forgetChat: (conversationId: number) => void
  /** Adds cards to the context of the active (or last used) chat; false when no chat is open. */
  addToChatContext: (cardIds: number[], state?: CardState) => boolean
  setSelectedMessage: (id: number | null) => void
  setNotice: (message: string | null) => void
  openWhy: (target: WhyTarget) => void
  closeWhy: () => void
  setExpectedCalls: (calls: number | null) => void
}

function findTab(panes: Pane[], tabId: string): { pane: number; tab: Tab } | null {
  for (let i = 0; i < panes.length; i++) {
    const tab = panes[i].tabs.find((t) => t.id === tabId)
    if (tab) return { pane: i, tab }
  }
  return null
}

/** Drops empty second panes and keeps `activePane` valid. */
function normalize(panes: Pane[], activePane: number): Pick<WorkspaceState, 'panes' | 'activePane'> {
  let next = panes
  if (next.length > 1) next = next.filter((p, i) => i === 0 || p.tabs.length > 0)
  if (next.length > 1 && next[0].tabs.length === 0) next = [next[1]]
  return { panes: next, activePane: Math.min(activePane, next.length - 1) }
}

function pickActive(pane: Pane, closedIndex: number): string | null {
  if (pane.tabs.length === 0) return null
  return pane.tabs[Math.min(closedIndex, pane.tabs.length - 1)].id
}

/** localStorage may be missing or throw (private mode, blocked data): fall back to memory. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // ignore
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // ignore
    }
  },
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      panes: [{ tabs: [], activeTabId: null }],
      activePane: 0,
      sidebarOpen: true,
      inspectorOpen: false,
      paletteOpen: false,
      graphSelection: [],
      mergeIds: null,
      lastMerge: null,
      chatContexts: {},
      lastChatId: null,
      selectedMessageId: null,
      notice: null,
      why: null,
      expectedCalls: null,

      // One view at a time: the sidebar navigates, opening something replaces what is shown (no tab bar, no second pane).
      openTab: (tab) => {
        set({ panes: [{ tabs: [{ ...tab, preview: undefined }], activeTabId: tab.id }], activePane: 0 })
      },

      closeTab: (tabId) => {
        const { panes, activePane } = get()
        const found = findTab(panes, tabId)
        if (!found) return
        const next = panes.map((p, i) => {
          if (i !== found.pane) return p
          const idx = p.tabs.findIndex((t) => t.id === tabId)
          const tabs = p.tabs.filter((t) => t.id !== tabId)
          const rest = { ...p, tabs }
          return { ...rest, activeTabId: p.activeTabId === tabId ? pickActive(rest, idx) : p.activeTabId }
        })
        set(normalize(next, activePane))
      },

      closeActiveTab: () => {
        const { panes, activePane, closeTab } = get()
        const id = panes[activePane]?.activeTabId
        if (id) closeTab(id)
      },

      activateTab: (tabId) => {
        const { panes } = get()
        const found = findTab(panes, tabId)
        if (!found) return
        set({
          panes: panes.map((p, i) => (i === found.pane ? { ...p, activeTabId: tabId } : p)),
          activePane: found.pane,
        })
      },


      setActivePane: (pane) => set((s) => (pane < s.panes.length ? { activePane: pane } : s)),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setGraphSelection: (ids) => set({ graphSelection: ids }),
      openMerge: (ids) => set({ mergeIds: ids }),
      closeMerge: () => set({ mergeIds: null }),
      setLastMerge: (merge) => set({ lastMerge: merge }),

      syncChatContext: (conversationId, items, tokens) =>
        set((s) => {
          const old = s.chatContexts[conversationId]
          if (old?.custom) return { lastChatId: conversationId }
          return { lastChatId: conversationId, chatContexts: { ...s.chatContexts, [conversationId]: { items, custom: false, tokens } } }
        }),
      setChatTokens: (conversationId, tokens) =>
        set((s) => {
          const old = s.chatContexts[conversationId]
          if (!old || old.tokens === tokens) return s
          return { chatContexts: { ...s.chatContexts, [conversationId]: { ...old, tokens } } }
        }),
      editChatContext: (conversationId, items) =>
        set((s) => ({
          lastChatId: conversationId,
          chatContexts: { ...s.chatContexts, [conversationId]: { items, custom: true, tokens: s.chatContexts[conversationId]?.tokens ?? null } },
        })),
      resetChatContext: (conversationId) =>
        set((s) => {
          const old = s.chatContexts[conversationId]
          if (!old) return s
          return { chatContexts: { ...s.chatContexts, [conversationId]: { ...old, custom: false } } }
        }),
      forgetChat: (conversationId) =>
        set((s) => {
          const rest = { ...s.chatContexts }
          delete rest[conversationId]
          return { chatContexts: rest, lastChatId: s.lastChatId === conversationId ? null : s.lastChatId }
        }),
      addToChatContext: (cardIds, state = 'included') => {
        const s = get()
        const tab = selectActiveTab(s)
        const target = tab?.type === 'chat' ? tab.refId! : s.lastChatId
        const entry = target === null || target === undefined ? undefined : s.chatContexts[target]
        if (target === null || target === undefined || !entry) return false
        const known = new Set(entry.items.map((i) => i.cardId))
        const added = cardIds.filter((id) => !known.has(id))
        if (added.length === 0) return true
        s.editChatContext(target, [...entry.items, ...added.map((cardId) => ({ cardId, state }))])
        return true
      },
      setSelectedMessage: (id) => set({ selectedMessageId: id }),
      setNotice: (message) => set({ notice: message }),
      openWhy: (target) => set({ why: target }),
      closeWhy: () => set({ why: null, expectedCalls: null }),
      setExpectedCalls: (calls) => set({ expectedCalls: calls }),
    }),
    {
      name: 'promptsys.workspace',
      version: 2,
      // Version 1 kept several tabs and panes; only the view that was shown survives.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { panes?: Pane[]; activePane?: number }
        if (version >= 2 || !state.panes) return state as never
        const pane = state.panes[state.activePane ?? 0] ?? state.panes[0]
        const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
        return { ...state, panes: [{ tabs: tab ? [tab] : [], activeTabId: tab?.id ?? null }], activePane: 0 } as never
      },
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        panes: s.panes,
        activePane: s.activePane,
        sidebarOpen: s.sidebarOpen,
        inspectorOpen: s.inspectorOpen,
      }),
    },
  ),
)

/** The tab shown in the active pane, if any. */
export function selectActiveTab(s: Pick<WorkspaceState, 'panes' | 'activePane'>): Tab | null {
  const pane = s.panes[s.activePane]
  return pane?.tabs.find((t) => t.id === pane.activeTabId) ?? null
}
