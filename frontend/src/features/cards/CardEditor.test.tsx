import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockFetch, renderWithProviders, sampleCards } from '../../test/utils.tsx'
import { CardEditor } from './CardEditor.tsx'

const card = { ...sampleCards[0], body: 'hello', sourceName: null, mimeType: null, forkedFromId: null, links: [], backlinks: [] }

describe('CardEditor', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('autosaves edits with ifVersion after the debounce', async () => {
    let server = card
    const { calls } = mockFetch({
      'GET /api/cards/1': () => ({ body: server }),
      'GET /api/cards': { body: sampleCards },
      'PATCH /api/cards/1': ({ body }) => {
        server = { ...card, ...(body as object), version: 2 }
        return { body: server }
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<CardEditor cardId={1} />)
    const textarea = await screen.findByLabelText('Body')
    await user.type(textarea, '!')
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/cards/1')).toBe(true), { timeout: 3000 })
    expect(calls.find((c) => c.key === 'PATCH /api/cards/1')?.body).toEqual({ title: 'Alpha rules', body: 'hello!', ifVersion: 1 })
    expect(await screen.findByText(/Saved · v2/)).toBeInTheDocument()
  })

  it('offers a choice on a version conflict', async () => {
    mockFetch({
      'GET /api/cards/1': { body: card },
      'GET /api/cards': { body: sampleCards },
      'PATCH /api/cards/1': { status: 409, body: { error: { code: 'version_conflict', message: 'stale' } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CardEditor cardId={1} />)
    await user.type(await screen.findByLabelText('Body'), '!')
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(/changed elsewhere/)
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument()
  })

  it('switches to the Markdown preview', async () => {
    mockFetch({ 'GET /api/cards/1': { body: { ...card, body: '# Heading' } }, 'GET /api/cards': { body: sampleCards } })
    const user = userEvent.setup()
    renderWithProviders(<CardEditor cardId={1} />)
    await user.click(await screen.findByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
  })

  it('shows a message for an unknown card', async () => {
    mockFetch({})
    renderWithProviders(<CardEditor cardId={99} />)
    expect(await screen.findByText('c99 does not exist')).toBeInTheDocument()
  })
})
