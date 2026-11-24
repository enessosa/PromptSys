import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { makeTab, selectActiveTab, useWorkspace } from '../state/workspace.ts'
import { useUrlTabSync } from './routes.tsx'

const initial = useWorkspace.getState()

function Probe() {
  useUrlTabSync()
  return <div data-testid="path">{useLocation().pathname}</div>
}

describe('useUrlTabSync', () => {
  beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 }))

  it('opens the tab named by the URL', () => {
    render(
      <MemoryRouter initialEntries={['/card/7']}>
        <Probe />
      </MemoryRouter>,
    )
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('card:7')
    expect(screen.getByTestId('path')).toHaveTextContent('/card/7')
  })

  it('updates the URL when the active tab changes', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    )
    act(() => useWorkspace.getState().openTab(makeTab('graph')))
    expect(screen.getByTestId('path')).toHaveTextContent('/graph')
    act(() => useWorkspace.getState().closeActiveTab())
    expect(screen.getByTestId('path')).toHaveTextContent('/')
  })
})
