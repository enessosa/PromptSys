import type { CardKind, CardSummary } from '../../api/types.ts'

export const cardLabel = (id: number) => `c${id}`

export const KIND_COLORS: Record<CardKind, string> = {
  note: '#5eb5a6',
  file: '#7aa2d6',
  memory: '#c49bd6',
  rule: '#d6b36b',
  search: '#d68c7a',
}

export type TreeFolder = {
  type: 'folder'
  name: string
  path: string
  children: TreeNode[]
}
export type TreeCard = { type: 'card'; card: CardSummary }
export type TreeNode = TreeFolder | TreeCard

/** Builds the sidebar tree from `folderPath`; folders first, then cards, both sorted by name / id. */
export function buildTree(cards: CardSummary[]): TreeFolder {
  const root: TreeFolder = { type: 'folder', name: '', path: '', children: [] }
  for (const card of cards) {
    let node = root
    const parts = card.folderPath.split('/').filter(Boolean)
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let next = node.children.find((c): c is TreeFolder => c.type === 'folder' && c.path === path)
      if (!next) {
        next = { type: 'folder', name: part, path, children: [] }
        node.children.push(next)
      }
      node = next
    })
    node.children.push({ type: 'card', card })
  }
  const sort = (f: TreeFolder) => {
    f.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      if (a.type === 'folder' && b.type === 'folder') return a.name.localeCompare(b.name)
      return a.type === 'card' && b.type === 'card' ? a.card.id - b.card.id : 0
    })
    f.children.forEach((c) => c.type === 'folder' && sort(c))
  }
  sort(root)
  return root
}

export function folderPaths(cards: CardSummary[]): string[] {
  const set = new Set<string>()
  for (const c of cards) {
    const parts = c.folderPath.split('/').filter(Boolean)
    parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/')))
  }
  return [...set].sort()
}
