import { Handle, Position, type NodeProps } from '@xyflow/react'
import { HoverCard } from '../../components/HoverCard.tsx'
import { CardPreview } from '../cards/CardPreview.tsx'
import { cardLabel, KIND_COLORS } from '../cards/model.ts'
import { nodeScale, type CardFlowNode } from './nodeModel.ts'
import styles from './graph.module.css'

export function CardNode({ data, selected }: NodeProps<CardFlowNode>) {
  const scale = nodeScale(data.degree)
  return (
    <HoverCard content={<CardPreview id={data.cardId} />}>
      <div
        className={styles.node}
        data-selected={selected || undefined}
        data-context={data.inContext || undefined}
        data-dimmed={data.dimmed || undefined}
        style={{ fontSize: `${12 * scale}px`, padding: `${5 * scale}px ${9 * scale}px` }}
      >
        <Handle id="top" type="source" position={Position.Top} className={styles.handle} />
        <Handle id="left" type="source" position={Position.Left} className={styles.handle} />
        <span className={styles.nodeDot} style={{ background: KIND_COLORS[data.kind] }} />
        {data.origin === 'agent' && (
          <span
            className={styles.agentMark}
            data-review={data.reviewStatus ?? 'proposed'}
            role="img"
            aria-label={`Agent card, ${data.reviewStatus ?? 'proposed'}`}
            title={`Recorded by the agent · ${data.reviewStatus ?? 'proposed'}`}
          />
        )}
        <span className={styles.nodeId}>{cardLabel(data.cardId)}</span>
        <span className={styles.nodeTitle}>{data.title}</span>
        <Handle id="right" type="source" position={Position.Right} className={styles.handle} />
        <Handle id="bottom" type="source" position={Position.Bottom} className={styles.handle} />
      </div>
    </HoverCard>
  )
}
