import { makeTab, selectActiveTab, useWorkspace } from '../../state/workspace.ts'

/** Opens the branch view of the active chat (or the last used one); tells the user when no conversation is open. */
export function useOpenBranchView() {
  const openTab = useWorkspace((s) => s.openTab)
  const setNotice = useWorkspace((s) => s.setNotice)
  return (conversationId?: number) => {
    const state = useWorkspace.getState()
    const tab = selectActiveTab(state)
    const id = conversationId ?? (tab?.type === 'chat' || tab?.type === 'branches' ? tab.refId : (state.lastChatId ?? undefined))
    if (id === undefined) setNotice('Open a conversation first.')
    else openTab(makeTab('branches', id))
  }
}
