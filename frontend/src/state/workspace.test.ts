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

  it('shows one view at a time: opening replaces what is shown', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1))
    s.openTab(makeTab('graph'), { preview: true })
    expect(ids()).toEqual([['graph']])
    s.openTab(makeTab('card', 1), { pane: 1 })
    expect(ids()).toEqual([['card:1']])
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('card:1')
    expect(useWorkspace.getState().panes[0].tabs[0].preview).toBeUndefined()
  })

  it('closes the view', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('card', 1))
    s.closeActiveTab()
    expect(selectActiveTab(useWorkspace.getState())).toBeNull()
  })

  it('keeps only the shown view from an old layout with several tabs and panes', async () => {
    localStorage.setItem(
      'promptsys.workspace',
      JSON.stringify({ version: 1, state: { panes: [{ tabs: [makeTab('card', 1), makeTab('graph')], activeTabId: 'card:1' }, { tabs: [makeTab('chat', 2)], activeTabId: 'chat:2' }], activePane: 1 } }),
    )
    await useWorkspace.persist.rehydrate()
    expect(ids()).toEqual([['chat:2']])
    expect(useWorkspace.getState().activePane).toBe(0)
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
