import { describe, expect, it } from 'vitest'
import { computeLayout, pickSides } from './layout.ts'

describe('computeLayout', () => {
  const nodes = [
    { id: 1, x: 100, y: 100 },
    { id: 2, x: null, y: null },
    { id: 3, x: null, y: null },
  ]
  const links = [{ sourceId: 1, targetId: 2 }]

  it('only places nodes without stored position and is deterministic', () => {
    const a = computeLayout(nodes, links)
    expect([...a.keys()].sort()).toEqual([2, 3])
    expect(computeLayout(nodes, links)).toEqual(a)
  })

  it('places everything on re-layout and returns nothing when all are placed', () => {
    expect(computeLayout(nodes, links, { all: true }).size).toBe(3)
    expect(computeLayout([{ id: 1, x: 0, y: 0 }], []).size).toBe(0)
  })
})

describe('computeLayout spacing', () => {
  it('keeps wide cards apart: no two boxes of 220 × 40 overlap', () => {
    const nodes = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, x: null, y: null }))
    const links = nodes.slice(1).map((n) => ({ sourceId: 1, targetId: n.id }))
    const pos = [...computeLayout(nodes, links, { all: true }).values()]
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const overlap = Math.abs(pos[i].x - pos[j].x) < 220 && Math.abs(pos[i].y - pos[j].y) < 40
        expect(overlap).toBe(false)
      }
  })
})

describe('pickSides', () => {
  const box = (x: number, y: number) => ({ position: { x, y }, measured: { width: 200, height: 40 } })
  it('connects side by side cards left/right and stacked cards top/bottom', () => {
    expect(pickSides(box(0, 0), box(300, 20))).toEqual(['right', 'left'])
    expect(pickSides(box(300, 0), box(0, 0))).toEqual(['left', 'right'])
    // Wide cards whose corners are far apart horizontally but that sit on top of each other.
    expect(pickSides(box(0, 0), box(150, 90))).toEqual(['bottom', 'top'])
    expect(pickSides(box(0, 90), box(-150, 0))).toEqual(['top', 'bottom'])
  })
})
