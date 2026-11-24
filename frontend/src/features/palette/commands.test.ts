import { describe, expect, it } from 'vitest'
import { filterCommands, fuzzyScore, type PaletteCommand } from './commands.ts'

const cmd = (id: string, title: string, enabled?: boolean): PaletteCommand => ({ id, title, enabled, run: () => {} })
const commands = [
  cmd('new', 'New card'),
  cmd('graph', 'Open graph'),
  cmd('sidebar', 'Toggle sidebar'),
  cmd('merge', 'Merge selected cards', false),
  cmd('close', 'Close tab'),
]

describe('palette commands', () => {
  it('scores substring before subsequence matches and rejects non-matches', () => {
    expect(fuzzyScore('Open graph', 'graph')).toBeLessThan(fuzzyScore('Open graph', 'opgr')!)
    expect(fuzzyScore('Open graph', 'xyz')).toBeNull()
    expect(fuzzyScore('Open graph', '')).toBe(0)
  })

  it('filters by query and hides disabled commands', () => {
    expect(filterCommands(commands, '').map((c) => c.id)).toEqual(['new', 'graph', 'sidebar', 'close'])
    expect(filterCommands(commands, 'graph').map((c) => c.id)).toEqual(['graph'])
    expect(filterCommands(commands, 'opgr').map((c) => c.id)).toEqual(['graph'])
    expect(filterCommands(commands, 'merge')).toEqual([])
  })
})
