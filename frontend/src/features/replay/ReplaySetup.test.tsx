import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspace } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders, sampleCards } from '../../test/utils.tsx'
import { ReplaySetup } from './ReplaySetup.tsx'

const initial = useWorkspace.getState()
const base = [
  { cardId: 1, state: 'included', version: 1, position: 1, title: 'Alpha rules', kind: 'rule', excerpt: '' },
  { cardId: 2, state: 'included', version: 1, position: 2, title: 'Beta notes', kind: 'note', excerpt: '' },
] as never
const message = { id: 4, parentId: 3, role: 'assistant', content: 'a', status: 'complete' } as never
const timeline = { id: 22, conversationId: 1, name: 'replay', parentTimelineId: 10, branchPointId: 4, headMessageId: 4, changeSummary: 'excluded c2, edited c1 → c4', createdAt: '' }
const dryResponse = { timeline: null, pendingPrompts: [{ messageId: 5, content: 'Next question?' }, { messageId: 7, content: 'And then?' }], estimatedApiCalls: 2 }

function routes() {
  return {
    'GET /api/cards/1': { body: { ...sampleCards[0], body: 'Original body', links: [], backlinks: [], sourceName: null, mimeType: null, forkedFromId: null } },
    'POST /api/replays': ({ body }: { body: unknown }) => ((body as { dryRun?: boolean }).dryRun ? { body: dryResponse } : { status: 201, body: { timeline, pendingPrompts: dryResponse.pendingPrompts, estimatedApiCalls: 2 } }),
    'PATCH /api/conversations/1': { body: { id: 1, title: 't', activeTimelineId: 22 } },
  }
}

beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0, notice: null, expectedCalls: null }))
afterEach(() => vi.unstubAllGlobals())

describe('ReplaySetup', () => {
  it('sends state changes and edited cards, shows pending prompts and calls, then creates and switches the timeline', async () => {
    const { calls } = mockFetch(routes())
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<ReplaySetup conversationId={1} message={message} base={base} sourceTimelineId={10} onClose={onClose} />)

    await user.selectOptions(screen.getByLabelText('State of c2'), 'excluded')
    await user.click(screen.getByRole('button', { name: 'Edit text of c1' }))
    const text = await screen.findByLabelText('Text of c1')
    await user.clear(text)
    await user.type(text, 'Changed body')

    await user.click(screen.getByRole('button', { name: 'Estimate API calls' }))
    expect(await screen.findByText(/2 prompts to replay · expected 2 API calls/)).toBeInTheDocument()
    expect(screen.getByText('Next question?')).toBeInTheDocument()
    expect(useWorkspace.getState().expectedCalls).toBe(2)
    expect(calls.filter((c) => c.key === 'POST /api/replays')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Create (2 API calls)' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const create = calls.filter((c) => c.key === 'POST /api/replays')[1]
    expect(create.body).toEqual({
      fromMessageId: 4,
      mode: 'step',
      dryRun: false,
      sourceTimelineId: 10,
      contextChanges: { cards: [{ cardId: 2, state: 'excluded' }], editedCards: [{ cardId: 1, body: 'Changed body' }] },
    })
    expect(calls.find((c) => c.key === 'PATCH /api/conversations/1')?.body).toEqual({ activeTimelineId: 22 })
    expect(useWorkspace.getState().panes[0].activeTabId).toBe('chat:1')
  })

  it('requires the warning checkbox for automatic mode', async () => {
    mockFetch(routes())
    const user = userEvent.setup()
    renderWithProviders(<ReplaySetup conversationId={1} message={message} base={base} sourceTimelineId={10} onClose={() => {}} />)
    await user.click(screen.getByLabelText(/Automatic/))
    expect(screen.getByRole('button', { name: 'Estimate API calls' })).toBeDisabled()
    await user.click(screen.getByLabelText('I understand the risk of an automatic replay'))
    expect(screen.getByRole('button', { name: 'Estimate API calls' })).toBeEnabled()
  })

  it('shows a 400 (no following prompts) without creating anything', async () => {
    const { calls } = mockFetch({ ...routes(), 'POST /api/replays': { status: 400, body: { error: { code: 'validation_failed', message: 'No following prompts.' } } } })
    const user = userEvent.setup()
    renderWithProviders(<ReplaySetup conversationId={1} message={message} base={base} sourceTimelineId={10} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Estimate API calls' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No following prompts.')
    expect(calls.filter((c) => c.key === 'POST /api/replays')).toHaveLength(1)
  })
})
