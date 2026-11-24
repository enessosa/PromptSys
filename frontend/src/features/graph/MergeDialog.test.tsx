import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspace } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders, sampleCards } from '../../test/utils.tsx'
import { MergeDialog } from './MergeDialog.tsx'
import { undoErrorMessage } from './undoError.ts'
import { ApiError } from '../../api/client.ts'

const initial = useWorkspace.getState()
const card = { ...sampleCards[0], body: '', sourceName: null, mimeType: null, forkedFromId: null, links: [], backlinks: [] }

describe('MergeDialog', () => {
  beforeEach(() => useWorkspace.setState({ ...initial, lastMerge: null }))
  afterEach(() => vi.unstubAllGlobals())

  it('previews, lets the user edit, merges and records the result for the undo toast', async () => {
    const { calls } = mockFetch({
      'GET /api/cards': { body: sampleCards },
      'POST /api/merges/preview': { body: { title: 'Alpha rules', body: 'proposed', linkCount: 2 } },
      'POST /api/merges': { status: 201, body: { target: card, merges: [{ id: 9, targetId: 1, sourceId: 2, createdAt: '', undoneAt: null }] } },
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<MergeDialog cardIds={[1, 2]} onClose={onClose} />)

    const body = await screen.findByLabelText('Merged text')
    await waitFor(() => expect(body).toHaveValue('proposed'))
    expect(screen.getByText(/2 links will be moved to c1/)).toBeInTheDocument()

    await user.clear(body)
    await user.type(body, 'final text')
    await user.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const merge = calls.find((c) => c.key === 'POST /api/merges')
    expect(merge?.body).toEqual({ targetId: 1, sourceIds: [2], title: 'Alpha rules', body: 'final text' })
    expect(useWorkspace.getState().lastMerge?.merges[0].id).toBe(9)
  })

  it('shows an error and keeps Merge disabled when the preview fails', async () => {
    mockFetch({ 'GET /api/cards': { body: sampleCards } })
    renderWithProviders(<MergeDialog cardIds={[1, 2]} onClose={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/not available/)
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
  })

  it('translates undo errors', () => {
    expect(undoErrorMessage(new ApiError(409, 'merge_outdated', 'x'))).toBe('Card changed after the merge – undo not possible')
    expect(undoErrorMessage(new ApiError(409, 'merge_already_undone', 'x'))).toBe('This merge was already undone')
  })
})
