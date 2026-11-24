import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'

export type LayoutNode = { id: number; x: number | null; y: number | null }
export type LayoutLink = { sourceId: number; targetId: number }
export type Positions = Map<number, { x: number; y: number }>

type SimNode = SimulationNodeDatum & { id: number }

const TICKS = 300
/** Cards are wide and flat (up to 220 × 40 px): the simulation runs with y stretched, so round collision circles act like ellipses. */
const STRETCH = 2.2
const RADIUS = 125

/**
 * Force-directed layout. Nodes with a stored position stay where they are (fixed) unless `all` is set
 * ("Re-layout"); only nodes without a position get computed coordinates, which are returned.
 */
export function computeLayout(nodes: LayoutNode[], links: LayoutLink[], options: { all?: boolean } = {}): Positions {
  const free = nodes.filter((n) => options.all || n.x === null || n.y === null)
  const result: Positions = new Map()
  if (free.length === 0) return result

  const radius = 120 + 60 * Math.sqrt(nodes.length)
  const sim: SimNode[] = nodes.map((n, i) => {
    const placed = !options.all && n.x !== null && n.y !== null
    if (placed) return { id: n.id, x: n.x!, y: n.y! * STRETCH, fx: n.x!, fy: n.y! * STRETCH }
    // Start on a circle so the result is deterministic and nodes do not begin on top of each other.
    const angle = (2 * Math.PI * i) / nodes.length
    return { id: n.id, x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })
  const ids = new Set(sim.map((n) => n.id))
  const simLinks = links
    .filter((l) => ids.has(l.sourceId) && ids.has(l.targetId))
    .map((l) => ({ source: l.sourceId, target: l.targetId }))

  const simulation = forceSimulation(sim)
    .force('link', forceLink<SimNode, { source: number; target: number }>(simLinks).id((n) => n.id).distance(2 * RADIUS + 40).strength(0.5))
    .force('charge', forceManyBody().strength(-900))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(RADIUS).strength(1).iterations(3))
    .stop()
  for (let i = 0; i < TICKS; i++) simulation.tick()

  const freeIds = new Set(free.map((n) => n.id))
  for (const n of sim) {
    if (freeIds.has(n.id)) result.set(n.id, { x: Math.round(n.x ?? 0), y: Math.round((n.y ?? 0) / STRETCH) })
  }
  return result
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

type Box = { position: { x: number; y: number }; measured?: { width?: number; height?: number } }

/**
 * Picks the facing sides of two cards from their boxes (centres, measured size): side by side → left/right, otherwise
 * top/bottom. Comparing corners of wide cards picked the wrong sides and drew loops.
 */
export function pickSides(from: Box, to: Box): [Side, Side] {
  const size = (b: Box) => ({ w: b.measured?.width ?? 180, h: b.measured?.height ?? 36 })
  const a = size(from)
  const b = size(to)
  const dx = to.position.x + b.w / 2 - (from.position.x + a.w / 2)
  const dy = to.position.y + b.h / 2 - (from.position.y + a.h / 2)
  const sideBySide = Math.abs(dx) - (a.w + b.w) / 2 > Math.abs(dy) - (a.h + b.h) / 2
  if (sideBySide) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}
