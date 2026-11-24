import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeTab, selectActiveTab, useWorkspace } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders, sampleCards } from '../../test/utils.tsx'
import { CardTree } from './CardTree.tsx'

const initial = useWorkspace.getState()

describe('CardTree', () => {
  beforeEach(() => {
    useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 })
    mockFetch({ 'GET /api/cards': { body: sampleCards } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders folders, c-labels and titles from the API', async () => {
    renderWithProviders(<CardTree />)
    expect(await screen.findByText('Alpha rules')).toBeInTheDocument()
    expect(screen.getByText('project')).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByText('c1')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('opens a preview tab on click and a permanent tab on double click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CardTree />)
    await user.click(await screen.findByText('Beta notes'))
    expect(selectActiveTab(useWorkspace.getState())).toMatchObject({ id: 'card:2', preview: true })
    await user.dblClick(screen.getByText('Beta notes'))
    expect(useWorkspace.getState().panes[0].tabs[0].preview).toBe(false)
  })

  it('collapses a folder', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CardTree />)
    await screen.findByText('Alpha rules')
    await user.click(screen.getByText('project'))
    expect(screen.queryByText('Beta notes')).not.toBeInTheDocument()
  })

  it('filters by title', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CardTree />)
    await screen.findByText('Alpha rules')
    await user.type(screen.getByLabelText('Filter cards'), 'gam')
    await waitFor(() => expect(screen.queryByText('Alpha rules')).not.toBeInTheDocument())
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockFetch({ 'GET /api/cards': { body: [] } })
    renderWithProviders(<CardTree />)
    expect(await screen.findByText(/No cards yet/)).toBeInTheDocument()
    expect(makeTab('card', 1).id).toBe('card:1')
  })
})
