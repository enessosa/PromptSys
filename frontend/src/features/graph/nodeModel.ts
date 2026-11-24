import type { Node } from '@xyflow/react'
import type { CardKind } from '../../api/types.ts'

export type CardNodeData = {
  cardId: number
  title: string
  kind: CardKind
  degree: number
  /** Card is part of the active conversation context (accent ring); set once chat reports it. */
  inContext: boolean
  /** Does not match the text filter. */
  dimmed: boolean
  [key: string]: unknown
}

export type CardFlowNode = Node<CardNodeData, 'card'>

/** Nodes grow slightly with their number of links (capped). */
export function nodeScale(degree: number): number {
  return 1 + Math.min(degree, 10) * 0.05
}
