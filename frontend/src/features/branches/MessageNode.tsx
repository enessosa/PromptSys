import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { LaneNode } from './layout.ts'
import styles from './branches.module.css'

export type MessageNodeData = { node: LaneNode; [key: string]: unknown }
export type LaneHeaderData = { name: string; summary: string | null; status: string | null; active: boolean; [key: string]: unknown }

export type MessageFlowNode = Node<MessageNodeData, 'message'>
export type HeaderFlowNode = Node<LaneHeaderData, 'lane'>

export function MessageNode({ data }: NodeProps<MessageFlowNode>) {
  const n = data.node
  return (
    <div className={styles.node} data-role={n.role} data-replay={n.replay || undefined} data-status={n.status} title={n.excerpt}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <span className={styles.nodeDot} />
      <span className={styles.nodeText}>
        <span className={styles.nodeRole}>{n.role === 'user' ? 'You' : 'Model'}</span>
        {n.excerpt || '(empty)'}
      </span>
      {n.labels.map((l) => (
        <span key={l} className={styles.branchLabel}>
          {l}
        </span>
      ))}
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  )
}

export function LaneHeader({ data }: NodeProps<HeaderFlowNode>) {
  return (
    <div className={styles.header} data-active={data.active || undefined}>
      <strong>{data.name}</strong>
      {data.summary && <span>{data.summary}</span>}
      {data.status && <span className={styles.status}>replay {data.status.replace('_', ' ')}</span>}
    </div>
  )
}
