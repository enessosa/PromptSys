import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { selectActiveTab, useWorkspace } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import { ConversationList } from './ConversationList.tsx'

const initial = useWorkspace.getState()
const conv = (id: number, title: string) => ({ id, title, model: null, activeTimelineId: id * 10 })
const tree = (id: number, branches: number) => ({
  timelines: [
    { id: id * 10, conversationId: id, name: 'main', parentTimelineId: null, changeSummary: null },
    ...Array.from({ length: branches }, (_, i) => ({ id: id * 10 + i + 1, conversationId: id, name: `Branch ${i + 1}`, parentTimelineId: id * 10, changeSummary: 'excluded c2' })),
  ],
  messages: [],
})

describe('ConversationList', () => {
  beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 }))
  afterEach(() => vi.unstubAllGlobals())

  it('lists conversations with branches as indented children and opens a chat tab', async () => {
    mockFetch({
      'GET /api/conversations': { body: [conv(1, 'Field rules'), conv(2, 'Other')] },
      'GET /api/conversations/1/tree': { body: tree(1, 1) },
      'GET /api/conversations/2/tree': { body: tree(2, 0) },
    })
    const user = userEvent.setup()
    renderWithProviders(<ConversationList />)
    expect(await screen.findByText('Field rules')).toBeInTheDocument()
    expect(await screen.findByLabelText('Branch Branch 1')).toHaveTextContent('excluded c2')
    await user.dblClick(screen.getByText('Other'))
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('chat:2')
  })

  it('creates a conversation and opens it', async () => {
    let created = false
    const { calls } = mockFetch({
      'GET /api/conversations': () => ({ body: created ? [conv(5, 'New conversation')] : [] }),
      'GET /api/conversations/5/tree': { body: tree(5, 0) },
      'POST /api/conversations': () => {
        created = true
        return { status: 201, body: conv(5, 'New conversation') }
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<ConversationList />)
    await user.click(await screen.findByRole('button', { name: 'New conversation' }))
    await waitFor(() => expect(selectActiveTab(useWorkspace.getState())?.id).toBe('chat:5'))
    expect(calls.some((c) => c.key === 'POST /api/conversations')).toBe(true)
  })

  it('asks for confirmation in an in-app dialog before deleting', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { calls } = mockFetch({
      'GET /api/conversations': { body: [conv(1, 'Field rules')] },
      'GET /api/conversations/1/tree': { body: tree(1, 0) },
      'DELETE /api/conversations/1': { status: 204 },
    })
    const user = userEvent.setup()
    renderWithProviders(<ConversationList />)
    await user.click(await screen.findByLabelText('Delete Field rules'))
    expect(calls.some((c) => c.key === 'DELETE /api/conversations/1')).toBe(false)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/conversations/1')).toBe(true))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('renames a conversation', async () => {
    const { calls } = mockFetch({
      'GET /api/conversations': { body: [conv(1, 'Field rules')] },
      'GET /api/conversations/1/tree': { body: tree(1, 0) },
      'PATCH /api/conversations/1': { body: conv(1, 'Renamed') },
    })
    const user = userEvent.setup()
    renderWithProviders(<ConversationList />)
    await user.click(await screen.findByLabelText('Rename Field rules'))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/conversations/1')?.body).toEqual({ title: 'Renamed' }))
  })
})
