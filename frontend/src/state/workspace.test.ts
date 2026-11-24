import { beforeEach, describe, expect, it } from 'vitest'
import { makeTab, pathToTab, selectActiveTab, tabPath, useWorkspace } from './workspace.ts'

const initial = useWorkspace.getState()
const ids = () => useWorkspace.getState().panes.map((p) => p.tabs.map((t) => t.id))

beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 }))

describe('workspace store', () => {
  it('maps URLs to tabs and back', () => {
    expect(pathToTab('/card/12')).toEqual(makeTab('card', 12))
    expect(pathToTab('/graph')).toEqual(makeTab('graph'))
    expect(pathToTab('/chat/3')).toEqual(makeTab('chat', 3))
    expect(pathToTab('/card/abc')).toBeNull()
    expect(pathToTab('/')).toBeNull()
    expect(tabPath(makeTab('card', 12))).toBe('/card/12')
    expect(tabPath(makeTab('graph'))).toBe('/graph')
  })

  it('opens each tab once and activates it', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1))
    s.openTab(makeTab('graph'))
    s.openTab(makeTab('card', 1))
    expect(ids()).toEqual([['card:1', 'graph']])
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('card:1')
  })

  it('replaces a preview tab by the next preview and promotes it on permanent open', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1), { preview: true })
    s.openTab(makeTab('card', 2), { preview: true })
    expect(ids()).toEqual([['card:2']])
    s.openTab(makeTab('card', 2))
    expect(useWorkspace.getState().panes[0].tabs[0].preview).toBe(false)
    s.openTab(makeTab('card', 3), { preview: true })
    expect(ids()).toEqual([['card:2', 'card:3']])
  })

  it('closes a tab and activates a neighbour', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1))
    s.openTab(makeTab('card', 2))
    s.openTab(makeTab('card', 3))
    s.closeTab('card:3')
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('card:2')
    s.closeActiveTab()
    s.closeActiveTab()
    expect(selectActiveTab(useWorkspace.getState())).toBeNull()
  })

  it('supports at most two panes and drops an emptied second pane', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1))
    s.openTab(makeTab('graph'))
    s.moveTab('graph', 1)
    expect(ids()).toEqual([['card:1'], ['graph']])
    expect(useWorkspace.getState().activePane).toBe(1)
    s.openTab(makeTab('card', 5), { pane: 2 })
    expect(useWorkspace.getState().panes).toHaveLength(2)
    s.closeTab('graph')
    s.closeTab('card:5')
    expect(useWorkspace.getState().panes).toHaveLength(1)
  })

  it('moves tabs back to the first pane and removes the empty pane', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1))
    s.openTab(makeTab('graph'), { pane: 1 })
    s.moveTab('graph', 0)
    expect(ids()).toEqual([['card:1', 'graph']])
  })

  it('toggles sidebar and inspector', () => {
    const s = useWorkspace.getState()
    s.toggleSidebar()
    s.toggleInspector()
    expect(useWorkspace.getState().sidebarOpen).toBe(false)
    expect(useWorkspace.getState().inspectorOpen).toBe(true)
  })

  it('persists layout but not the palette state', () => {
    useWorkspace.getState().openTab(makeTab('graph'))
    useWorkspace.getState().setPaletteOpen(true)
    const saved = JSON.parse(localStorage.getItem('promptsys.workspace') ?? '{}') as { state: Record<string, unknown> }
    expect(saved.state.panes).toBeDefined()
    expect(saved.state.paletteOpen).toBeUndefined()
  })
})
