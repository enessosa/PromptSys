import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { selectActiveTab, useWorkspace } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders, sampleCards } from '../../test/utils.tsx'
import type { PaletteCommand } from './commands.ts'
import { PaletteBody } from './CommandPalette.tsx'

const initial = useWorkspace.getState()

describe('PaletteBody', () => {
  beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 }))
  afterEach(() => vi.unstubAllGlobals())

  it('lists commands and recent cards, filters while typing and runs a command with Enter', async () => {
    mockFetch({
      'GET /api/cards': ({ url }) => ({
        body: sampleCards.filter((c) => c.title.toLowerCase().includes((url.searchParams.get('query') ?? '').toLowerCase())),
      }),
    })
    const run = vi.fn()
    const commands: PaletteCommand[] = [
      { id: 'graph', title: 'Open graph', run },
      { id: 'close', title: 'Close tab', run: () => {} },
    ]
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<PaletteBody commands={commands} onClose={onClose} />)

    expect(await screen.findByText('Alpha rules')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/Search cards/), 'graph')
    expect(screen.queryByText('Close tab')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('opens a card found by title, and uses the second pane with Ctrl+Enter', async () => {
    mockFetch({
      'GET /api/search': { status: 404, body: { error: { code: 'not_found', message: 'x' } } },
      'GET /api/cards': { body: [sampleCards[2]] },
    })
    const user = userEvent.setup()
    renderWithProviders(<PaletteBody commands={[]} onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText(/Search cards/), 'gamma')
    await screen.findByText('Gamma')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('card:3')
    expect(useWorkspace.getState().activePane).toBe(1)
  })
})
