import type { CardKind } from '../../api/types.ts'
import { cardLabel } from '../cards/model.ts'

export type GraphFilters = { kind: CardKind | ''; folder: string; text: string }

export function matchesText(node: { id: number; title: string }, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (!q) return true
  return node.title.toLowerCase().includes(q) || cardLabel(node.id) === q || String(node.id) === q
}

export function inFolder(folderPath: string, folder: string): boolean {
  return !folder || folderPath === folder || folderPath.startsWith(`${folder}/`)
}
