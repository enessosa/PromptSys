import { describe, expect, it } from 'vitest'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { renderWithProviders } from '../../test/utils.tsx'
import { CardNode } from './CardNode.tsx'

describe('CardNode', () => {
  it('offers a handle on each of the four sides', () => {
    const { container } = renderWithProviders(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 300 }}>
          <ReactFlow
            nodeTypes={{ card: CardNode }}
            nodes={[{ id: '1', type: 'card', position: { x: 0, y: 0 }, data: { cardId: 1, title: 'A', kind: 'note', degree: 0, inContext: false, dimmed: false } }]}
            edges={[]}
          />
        </div>
      </ReactFlowProvider>,
    )
    const ids = [...container.querySelectorAll('.react-flow__handle')].map((h) => h.getAttribute('data-handleid')).sort()
    expect(ids).toEqual(['bottom', 'left', 'right', 'top'])
  })
})
