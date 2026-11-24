import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import { GraphView } from './GraphView.tsx'

const graph = {
  nodes: [1, 2, 3].map((id) => ({ id, title: `Card ${id}`, kind: 'note', folderPath: '', x: id * 120, y: 0, degree: 1 })),
  links: [{ id: 1, sourceId: 1, targetId: 2, kind: 'related', label: null, createdAt: '' }],
}

describe('GraphView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders one node per card', async () => {
    mockFetch({ 'GET /api/graph': { body: graph } })
    const { container } = renderWithProviders(
      <div style={{ width: 800, height: 600 }}>
        <GraphView />
      </div>,
    )
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3))
  })

  it('shows an empty state without cards', async () => {
    mockFetch({ 'GET /api/graph': { body: { nodes: [], links: [] } } })
    const { findByText } = renderWithProviders(<GraphView />)
    expect(await findByText('No cards yet')).toBeInTheDocument()
  })
})
