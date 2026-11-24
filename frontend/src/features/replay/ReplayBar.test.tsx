import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import { ReplayBar } from './ReplayBar.tsx'

const timeline = (over = {}) => ({
  id: 22, conversationId: 1, name: 'replay', parentTimelineId: 10, branchPointId: 2, headMessageId: 2, changeSummary: 'excluded c2', createdAt: '',
  replayStatus: 'paused' as const, replayMode: 'step' as const, replaySourceId: 10, replayNextId: 3, ...over,
})
const source = [{ id: 3, parentId: 2, role: 'user', content: 'Original next prompt', status: 'complete' }]

function setup(over: { tl?: object; busy?: boolean; routes?: Record<string, never> } = {}) {
  const m = mockFetch({
    'GET /api/timelines/10/messages': { body: source },
    'POST /api/replays/22/next': { body: { timeline: timeline() } },
    'POST /api/replays/22/branch-off': { body: { timeline: timeline({ replayStatus: 'branched_off' }) } },
    'POST /api/replays/22/cancel': { body: { timeline: timeline({ replayStatus: 'cancelled' }) } },
    ...over.routes,
  })
  const handlers = { onNext: vi.fn(), onAuto: vi.fn(), onStop: vi.fn() }
  renderWithProviders(<ReplayBar conversationId={1} timeline={timeline(over.tl)} busy={over.busy ?? false} progress={null} {...handlers} />)
  return { ...m, ...handlers }
}

afterEach(() => vi.unstubAllGlobals())

describe('ReplayBar', () => {
  it('shows the next original prompt and sends it', async () => {
    const { onNext } = setup()
    const user = userEvent.setup()
    expect(await screen.findByText('Original next prompt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onNext).toHaveBeenCalledWith('send', 'Original next prompt')
  })

  it('edits the prompt before sending', async () => {
    const { onNext } = setup()
    const user = userEvent.setup()
    await screen.findByText('Original next prompt')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Edited prompt')
    await user.clear(box)
    await user.type(box, 'Changed prompt')
    await user.click(screen.getByRole('button', { name: 'Send edited' }))
    expect(onNext).toHaveBeenCalledWith('edit', 'Changed prompt', 'Changed prompt')
  })

  it('skips, branches off and cancels through the API', async () => {
    const { calls } = setup()
    const user = userEvent.setup()
    await screen.findByText('Original next prompt')
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/replays/22/next')?.body).toEqual({ action: 'skip' }))
    await user.click(screen.getByRole('button', { name: 'Branch off' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/replays/22/branch-off')).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Cancel replay' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel replay' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/replays/22/cancel')).toBe(true))
  })

  it('reports replay_not_active', async () => {
    setup({ routes: { 'POST /api/replays/22/next': { status: 409, body: { error: { code: 'replay_not_active', message: 'x' } } } as never } })
    const user = userEvent.setup()
    await screen.findByText('Original next prompt')
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer active')
  })

  it('offers Run all with a warning in auto mode and Stop while running', async () => {
    const { onAuto } = setup({ tl: { replayMode: 'auto' } })
    const user = userEvent.setup()
    expect(screen.getByText(/may no longer fit/)).toBeInTheDocument()
    await screen.findByText('Original next prompt')
    await user.click(screen.getByRole('button', { name: 'Run all' }))
    expect(onAuto).toHaveBeenCalled()
  })

  it('shows Stop while an auto replay streams', async () => {
    const { onStop } = setup({ tl: { replayMode: 'auto' }, busy: true })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
})
