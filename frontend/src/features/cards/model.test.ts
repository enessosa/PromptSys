import { describe, expect, it } from 'vitest'
import type { CardSummary } from '../../api/types.ts'
import { sampleCards } from '../../test/utils.tsx'
import { buildTree, folderPaths } from './model.ts'

describe('buildTree', () => {
  it('nests folders from folderPath, folders before cards', () => {
    const tree = buildTree(sampleCards as CardSummary[])
    expect(tree.children.map((n) => (n.type === 'folder' ? `dir:${n.path}` : `card:${n.card.id}`))).toEqual(['dir:project', 'card:3'])
    const project = tree.children[0]
    if (project.type !== 'folder') throw new Error('expected folder')
    expect(project.children.map((n) => (n.type === 'folder' ? n.path : n.card.id))).toEqual(['project/api', 2])
  })

  it('lists all folder prefixes', () => {
    expect(folderPaths(sampleCards as CardSummary[])).toEqual(['project', 'project/api'])
  })
})
