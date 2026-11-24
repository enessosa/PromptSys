import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force'

export type LayoutNode = { id: number; x: number | null; y: number | null }
export type LayoutLink = { sourceId: number; targetId: number }
export type Positions = Map<number, { x: number; y: number }>

type SimNode = SimulationNodeDatum & { id: number }

const TICKS = 300

/**
 * Force-directed layout. Nodes with a stored position stay where they are (fixed) unless `all` is set
 * ("Re-layout"); only nodes without a position get computed coordinates, which are returned.
 */
export function computeLayout(nodes: LayoutNode[], links: LayoutLink[], options: { all?: boolean } = {}): Positions {
  const free = nodes.filter((n) => options.all || n.x === null || n.y === null)
  const result: Positions = new Map()
  if (free.length === 0) return result

  const radius = 60 + 22 * Math.sqrt(nodes.length)
  const sim: SimNode[] = nodes.map((n, i) => {
    const placed = !options.all && n.x !== null && n.y !== null
    if (placed) return { id: n.id, x: n.x!, y: n.y!, fx: n.x!, fy: n.y! }
    // Start on a circle so the result is deterministic and nodes do not begin on top of each other.
    const angle = (2 * Math.PI * i) / nodes.length
    return { id: n.id, x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })
  const ids = new Set(sim.map((n) => n.id))
  const simLinks = links
    .filter((l) => ids.has(l.sourceId) && ids.has(l.targetId))
    .map((l) => ({ source: l.sourceId, target: l.targetId }))

  const simulation = forceSimulation(sim)
    .force('link', forceLink<SimNode, { source: number; target: number }>(simLinks).id((n) => n.id).distance(120).strength(0.6))
    .force('charge', forceManyBody().strength(-380))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(60))
    .stop()
  for (let i = 0; i < TICKS; i++) simulation.tick()

  const freeIds = new Set(free.map((n) => n.id))
  for (const n of sim) {
    if (freeIds.has(n.id)) result.set(n.id, { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) })
  }
  return result
}
