import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import type { ReactFlowProps } from '@xyflow/react'
import { GraphView } from './GraphView.tsx'

const flowProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
vi.mock('@xyflow/react', async (orig) => {
  const mod = await orig<typeof import('@xyflow/react')>()
  return {
    ...mod,
    ReactFlow: (props: ReactFlowProps) => {
      flowProps.current = props as unknown as Record<string, unknown>
      return <mod.ReactFlow {...props} />
    },
  }
})

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

  it('fits the view with padding and a zoom cap, and allows links from every side', async () => {
    mockFetch({ 'GET /api/graph': { body: graph } })
    renderWithProviders(
      <div style={{ width: 800, height: 600 }}>
        <GraphView />
      </div>,
    )
    await waitFor(() => expect(flowProps.current).not.toBeNull())
    expect(flowProps.current).toMatchObject({ fitView: true, fitViewOptions: { padding: 0.2, maxZoom: 1 }, connectionMode: 'loose' })
  })

  it('shows an empty state without cards', async () => {
    mockFetch({ 'GET /api/graph': { body: { nodes: [], links: [] } } })
    const { findByText } = renderWithProviders(<GraphView />)
    expect(await findByText('No cards yet')).toBeInTheDocument()
  })
})
