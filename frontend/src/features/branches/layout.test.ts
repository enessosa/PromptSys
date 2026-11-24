import { describe, expect, it } from 'vitest'
import type { ConversationTree } from '../../api/types.ts'
import { LANE_WIDTH, layoutBranches, NODE_HEIGHT, NODE_WIDTH, ROW_HEIGHT } from './layout.ts'

const tl = (id: number, name: string, over: Partial<ConversationTree['timelines'][number]> = {}) => ({
  id, conversationId: 1, name, parentTimelineId: null, branchPointId: null, headMessageId: null, changeSummary: null, createdAt: '', ...over,
})
const msg = (id: number, parentId: number | null, role: 'user' | 'assistant', timelineIds: number[], over = {}) => ({
  id, parentId, role, status: 'complete' as const, excerpt: `m${id}`, timelineIds, ...over,
})

// main: 1 -> 2 -> 3 -> 4; branch "b" forks after message 2 with a changed question 5 -> 6
const tree: ConversationTree = {
  timelines: [tl(11, 'b', { parentTimelineId: 10, branchPointId: 2, changeSummary: 'excluded c2' }), tl(10, 'main')],
  messages: [
    msg(1, null, 'user', [10, 11]),
    msg(2, 1, 'assistant', [10, 11]),
    msg(3, 2, 'user', [10]),
    msg(4, 3, 'assistant', [10]),
    msg(5, 2, 'user', [11], { replayOfId: 3 }),
    msg(6, 5, 'assistant', [11]),
  ],
}

describe('layoutBranches', () => {
  const layout = layoutBranches(tree)
  const node = (id: number) => layout.nodes.find((n) => n.messageId === id)!

  it('creates one lane per timeline, parents first', () => {
    expect(layout.lanes.map((l) => [l.name, l.x])).toEqual([['main', 0], ['b', LANE_WIDTH]])
  })

  it('draws shared messages once, on the lane of the first timeline', () => {
    expect(layout.nodes).toHaveLength(6)
    expect(node(1).lane).toBe(0)
    expect(node(2).lane).toBe(0)
    expect(node(5).lane).toBe(1)
  })

  it('uses the message depth as the row', () => {
    expect(node(1).y).toBe(0)
    expect(node(4).y).toBe(3 * ROW_HEIGHT)
    expect(node(5).y).toBe(2 * ROW_HEIGHT)
    expect(node(6).y).toBe(3 * ROW_HEIGHT)
  })

  it('labels the branch point with the change summary and marks replays', () => {
    expect(node(2).labels).toEqual(['b: excluded c2'])
    expect(node(5).replay).toBe(true)
    expect(node(3).replay).toBe(false)
  })

  it('puts the branch label beside the node, clear of connectors and the dashed fork edge', () => {
    const n = node(2)
    const box = n.labelBox!
    expect(box).not.toBeNull()
    expect(node(3).labelBox).toBeNull()
    // right of the node, inside its own lane gap
    expect(box.x).toBeGreaterThanOrEqual(n.x + NODE_WIDTH)
    expect(box.x + box.width).toBeLessThanOrEqual(n.x + LANE_WIDTH)
    // vertical connector of the lane (node centre) and the next lane's connector are not inside the box
    for (const cx of [n.x + NODE_WIDTH / 2, node(5).x + NODE_WIDTH / 2]) {
      expect(cx < box.x || cx > box.x + box.width).toBe(true)
    }
    // the fork edge runs horizontally between the rows, below the node: the label stays above it
    const forkRunY = n.y + NODE_HEIGHT + (ROW_HEIGHT - NODE_HEIGHT) / 2
    expect(box.y + box.height).toBeLessThan(forkRunY)
    // no node box (other than the owner) overlaps the label
    for (const o of layout.nodes.filter((o) => o !== n)) {
      const overlap = box.x < o.x + NODE_WIDTH && box.x + box.width > o.x && box.y < o.y + NODE_HEIGHT && box.y + box.height > o.y
      expect(overlap).toBe(false)
    }
  })

  it('marks edges that cross lanes (the fork)', () => {
    const cross = layout.edges.filter((e) => e.crossLane).map((e) => e.id)
    expect(cross).toEqual(['e2-5'])
    expect(layout.edges).toHaveLength(5)
  })

  it('copes with an empty tree and with a message whose parent is unknown', () => {
    expect(layoutBranches({ timelines: [], messages: [] }).nodes).toEqual([])
    const odd = layoutBranches({ timelines: [tl(1, 'main')], messages: [msg(9, 404, 'user', [1])] })
    expect(odd.nodes[0].depth).toBe(0)
    expect(odd.edges).toEqual([])
  })
})
