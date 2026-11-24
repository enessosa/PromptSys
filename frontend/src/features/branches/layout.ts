import type { ConversationTree } from '../../api/types.ts'

export const LANE_WIDTH = 240
export const ROW_HEIGHT = 64
export const HEADER_HEIGHT = 56

type TreeMessage = ConversationTree['messages'][number]

export type Lane = { timelineId: number; index: number; x: number; name: string; changeSummary: string | null; replayStatus: string | null; parentTimelineId: number | null }

export type LaneNode = {
  id: string
  messageId: number
  /** Timeline that owns the lane the node is drawn in (the first timeline that contains the message). */
  timelineId: number
  lane: number
  depth: number
  x: number
  y: number
  role: TreeMessage['role']
  status: TreeMessage['status']
  excerpt: string
  replay: boolean
  /** Branch labels of the timelines that fork off after this message ("name: change summary"). */
  labels: string[]
}

export type LaneEdge = { id: string; source: string; target: string; crossLane: boolean }

export type BranchLayout = { lanes: Lane[]; nodes: LaneNode[]; edges: LaneEdge[]; width: number; height: number }

/**
 * Git-graph-like layout: one lane per timeline (in creation order), one row per message depth.
 * A message shared by several timelines is drawn once, in the lane of the first of them.
 * Pure function of the tree, so it can be tested without React.
 */
export function layoutBranches(tree: ConversationTree): BranchLayout {
  const timelines = [...tree.timelines].sort((a, b) => a.id - b.id)
  const laneOf = new Map(timelines.map((t, i) => [t.id, i]))
  const lanes: Lane[] = timelines.map((t, i) => ({
    timelineId: t.id,
    index: i,
    x: i * LANE_WIDTH,
    name: t.name,
    changeSummary: t.changeSummary,
    replayStatus: t.replayStatus ?? null,
    parentTimelineId: t.parentTimelineId,
  }))

  const byId = new Map(tree.messages.map((m) => [m.id, m]))
  const depthOf = new Map<number, number>()
  const depth = (m: TreeMessage): number => {
    const known = depthOf.get(m.id)
    if (known !== undefined) return known
    // Walk up iteratively (long conversations must not overflow the stack); a cycle counts as a root.
    const chain: TreeMessage[] = []
    let cur: TreeMessage | undefined = m
    const seen = new Set<number>()
    while (cur && !depthOf.has(cur.id) && !seen.has(cur.id)) {
      seen.add(cur.id)
      chain.push(cur)
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId)
    }
    let d = cur && depthOf.has(cur.id) ? depthOf.get(cur.id)! + 1 : 0
    for (let i = chain.length - 1; i >= 0; i--) depthOf.set(chain[i].id, d++)
    return depthOf.get(m.id)!
  }

  const labels = new Map<number, string[]>()
  for (const t of timelines) {
    if (t.branchPointId == null || t.parentTimelineId == null) continue
    const list = labels.get(t.branchPointId) ?? []
    list.push(`${t.name}: ${t.changeSummary ?? 'branch'}`)
    labels.set(t.branchPointId, list)
  }

  const nodes: LaneNode[] = tree.messages.map((m) => {
    const owner = m.timelineIds.map((id) => laneOf.get(id)).filter((i): i is number => i !== undefined).sort((a, b) => a - b)[0] ?? 0
    const d = depth(m)
    return {
      id: `m${m.id}`,
      messageId: m.id,
      timelineId: lanes[owner]?.timelineId ?? 0,
      lane: owner,
      depth: d,
      x: owner * LANE_WIDTH,
      y: d * ROW_HEIGHT,
      role: m.role,
      status: m.status,
      excerpt: m.excerpt,
      replay: m.replayOfId != null,
      labels: labels.get(m.id) ?? [],
    }
  })

  const laneByMessage = new Map(nodes.map((n) => [n.messageId, n.lane]))
  const edges: LaneEdge[] = tree.messages
    .filter((m) => m.parentId !== null && byId.has(m.parentId))
    .map((m) => ({
      id: `e${m.parentId}-${m.id}`,
      source: `m${m.parentId}`,
      target: `m${m.id}`,
      crossLane: laneByMessage.get(m.parentId!) !== laneByMessage.get(m.id),
    }))

  const maxDepth = nodes.reduce((acc, n) => Math.max(acc, n.depth), 0)
  return { lanes, nodes, edges, width: Math.max(1, lanes.length) * LANE_WIDTH, height: (maxDepth + 1) * ROW_HEIGHT }
}
