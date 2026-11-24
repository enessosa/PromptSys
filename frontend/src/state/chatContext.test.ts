import { beforeEach, describe, expect, it } from 'vitest'
import { makeTab, useWorkspace } from './workspace.ts'

const initial = useWorkspace.getState()

describe('chat context in the workspace', () => {
  beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0, chatContexts: {}, lastChatId: null }))

  it('reports no chat when none has synced a context', () => {
    expect(useWorkspace.getState().addToChatContext([3])).toBe(false)
  })

  it('adds cards to the active chat, once, as a custom state', () => {
    const s = useWorkspace.getState()
    s.openTab(makeTab('chat', 4))
    s.syncChatContext(4, [{ cardId: 1, state: 'included' }], 50)
    expect(useWorkspace.getState().addToChatContext([1, 3])).toBe(true)
    const ctx = useWorkspace.getState().chatContexts[4]
    expect(ctx.custom).toBe(true)
    expect(ctx.items).toEqual([{ cardId: 1, state: 'included' }, { cardId: 3, state: 'included' }])
  })

  it('ignores backend syncs while the user has a custom state, and resets back', () => {
    const s = useWorkspace.getState()
    s.syncChatContext(4, [{ cardId: 1, state: 'included' }], 50)
    s.editChatContext(4, [{ cardId: 2, state: 'pinned' }])
    s.syncChatContext(4, [{ cardId: 1, state: 'included' }], 60)
    expect(useWorkspace.getState().chatContexts[4].items).toEqual([{ cardId: 2, state: 'pinned' }])
    s.resetChatContext(4)
    s.syncChatContext(4, [{ cardId: 1, state: 'included' }], 60)
    expect(useWorkspace.getState().chatContexts[4].items).toEqual([{ cardId: 1, state: 'included' }])
  })
})
