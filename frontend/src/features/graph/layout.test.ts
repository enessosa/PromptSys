import { describe, expect, it } from 'vitest'
import { computeLayout } from './layout.ts'

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
