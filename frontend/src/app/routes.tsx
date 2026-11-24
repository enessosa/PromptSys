import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { pathToTab, selectActiveTab, tabPath, useWorkspace } from '../state/workspace.ts'

/**
 * Keeps the URL and the active tab in sync: `/card/:id`, `/graph`, `/chat/:id`.
 * URL → tab on navigation (reload, back/forward, links); tab → URL when the active tab changes.
 */
export function useUrlTabSync() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const activeKey = useWorkspace((s) => selectActiveTab(s)?.id ?? null)

  useEffect(() => {
    const tab = pathToTab(pathname)
    if (!tab) return
    const state = useWorkspace.getState()
    if (selectActiveTab(state)?.id !== tab.id) state.openTab(tab)
  }, [pathname])

  useEffect(() => {
    // Read the store directly: the URL effect above may just have changed the active tab.
    const tab = selectActiveTab(useWorkspace.getState())
    const target = tab ? tabPath(tab) : '/'
    if (target !== pathname && (tab || pathToTab(pathname))) navigate(target)
    // Only react to tab changes, not to the pathname (that direction is handled above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, navigate])
}
