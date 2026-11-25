import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { selectActiveTab, useWorkspace } from '../state/workspace.ts'
import { mockFetch, renderWithProviders, sampleCards } from '../test/utils.tsx'
import { Shell } from './Shell.tsx'

const initial = useWorkspace.getState()

describe('Shell', () => {
  beforeEach(() => {
    useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 })
    mockFetch({
      'GET /api/health': { body: { status: 'ok', apiKeyConfigured: false } },
      'GET /api/cards': { body: sampleCards },
      'GET /api/conversations': { status: 404, body: { error: { code: 'not_found', message: 'x' } } },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders ribbon, sidebar, empty tab area and status bar; conversations 404 means empty', async () => {
    renderWithProviders(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Ribbon' })).toBeInTheDocument()
    expect(await screen.findByText('Alpha rules')).toBeInTheDocument()
    expect(screen.getByText('Nothing open')).toBeInTheDocument()
    expect(await screen.findByText('No conversations yet.')).toBeInTheDocument()
    expect(await screen.findByText('No API key')).toBeInTheDocument()
  })

  it('opens the palette with Ctrl+K, and a card from the tree without a tab bar', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>,
    )
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByPlaceholderText(/Search cards/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(await screen.findByText('Gamma'))
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('card:3')
  })

  it('shows one offline state when the backend is unreachable and recovers when it is back', async () => {
    let up = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), 'http://localhost').pathname
        if (!up) return new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' })
        const body = path === '/api/health' ? { status: 'ok', apiKeyConfigured: true } : path === '/api/cards' ? sampleCards : []
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )
    const { client } = renderWithProviders(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Backend not reachable')).toBeInTheDocument()
    expect(screen.getAllByText(/Backend offline, waiting for it/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Cards could not be loaded.')).not.toBeInTheDocument()
    up = true
    await client.refetchQueries({ queryKey: ['health'] })
    await waitFor(() => expect(screen.queryByText('Backend not reachable')).not.toBeInTheDocument())
    expect(await screen.findByText('Alpha rules')).toBeInTheDocument()
  })
})
