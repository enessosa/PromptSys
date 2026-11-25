import { useEffect, useMemo, useRef } from 'react'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { useCreateCard } from '../cards/hooks.ts'
import { useOpenBranchView } from '../branches/useOpenBranchView.ts'
import { useNewConversation } from '../chat/hooks.ts'
import type { PaletteCommand } from './commands.ts'

/** Commands shared by the palette and the global shortcuts. */
export function useCommands(): PaletteCommand[] {
  const create = useCreateCard()
  const s = useWorkspace()
  const { mutate: createCard } = create
  const newConversation = useNewConversation()
  const openBranchView = useOpenBranchView()
  const activeCard = s.panes[s.activePane]?.activeTabId?.startsWith('card:') ? Number(s.panes[s.activePane].activeTabId!.slice(5)) : null
  return useMemo(
    () => [
      {
        id: 'new-card',
        title: 'New card',
        shortcut: 'Mod+N',
        run: () => createCard({ title: 'Untitled' }, { onSuccess: (c) => s.openTab(makeTab('card', c.id)) }),
      },
      { id: 'new-conversation', title: 'New conversation', shortcut: 'Mod+Shift+N', run: newConversation },
      {
        id: 'add-to-context',
        title: 'Add current card to context',
        enabled: activeCard !== null,
        run: () => {
          if (activeCard === null) return
          const ok = s.addToChatContext([activeCard])
          s.setNotice(ok ? `c${activeCard} added to the context.` : 'Open a conversation first.')
        },
      },
      { id: 'open-graph', title: 'Open graph', shortcut: 'Mod+G', run: () => s.openTab(makeTab('graph')) },
      { id: 'open-branches', title: 'Open branch view', run: () => openBranchView() },
      { id: 'open-settings', title: 'Open settings', run: () => s.openTab(makeTab('settings')) },
      { id: 'toggle-sidebar', title: 'Toggle sidebar', shortcut: 'Mod+B', run: s.toggleSidebar },
      { id: 'toggle-inspector', title: 'Toggle inspector', shortcut: 'Mod+Shift+B', run: s.toggleInspector },
      {
        id: 'merge-selected',
        title: 'Merge selected cards',
        enabled: s.graphSelection.length >= 2,
        run: () => {
          s.openTab(makeTab('graph'))
          s.openMerge(s.graphSelection)
        },
      },
      { id: 'close-tab', title: 'Close view', shortcut: 'Mod+W', run: s.closeActiveTab },
    ],
    // The store object changes on every update, which is what keeps `enabled` current.
    [s, createCard, newConversation, openBranchView, activeCard],
  )
}

/** Global keyboard shortcuts (Draft table); best effort, since browsers reserve some of them. */
export function useGlobalShortcuts(commands: PaletteCommand[]) {
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)
  const ref = useRef(commands)
  useEffect(() => {
    ref.current = commands
  })
  useEffect(() => {
    const byKey: Record<string, string> = { n: 'new-card', g: 'open-graph', b: 'toggle-sidebar', w: 'close-tab' }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'k' || key === 'o') {
        e.preventDefault()
        useWorkspace.getState().setPaletteOpen(true)
        return
      }
      const id =
        key === 'b' && e.shiftKey
          ? 'toggle-inspector'
          : key === 'n' && e.shiftKey
            ? 'new-conversation'
            : e.shiftKey
              ? undefined
              : byKey[key]
      const cmd = id && ref.current.find((c) => c.id === id)
      if (cmd) {
        e.preventDefault()
        cmd.run({ secondPane: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])
}
