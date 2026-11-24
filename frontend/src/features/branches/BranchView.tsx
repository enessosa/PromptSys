import { useMemo, useState } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button, Select } from '@primer/react'
import { EmptyState } from '../../components/EmptyState.tsx'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { useConversation, useSetActiveTimeline, useTree } from '../chat/hooks.ts'
import { CompareView } from './CompareView.tsx'
import { HEADER_HEIGHT, layoutBranches } from './layout.ts'
import { LaneHeader, MessageNode, type HeaderFlowNode, type MessageFlowNode } from './MessageNode.tsx'
import styles from './branches.module.css'

const nodeTypes = { message: MessageNode, lane: LaneHeader }

export function BranchView({ conversationId }: { conversationId: number }) {
  const tree = useTree(conversationId)
  const conversation = useConversation(conversationId)
  const [pair, setPair] = useState<[number, number] | null>(null)
  if (tree.isPending) return <EmptyState title="Loading branches…" />
  if (tree.isError) return <EmptyState title="Branches could not be loaded">{tree.error.message}</EmptyState>
  if (tree.data.messages.length === 0) return <EmptyState title="No messages yet">Branches appear here once the conversation has an answer.</EmptyState>
  if (pair) return <CompareView a={pair[0]} b={pair[1]} onBack={() => setPair(null)} />
  return (
    <ReactFlowProvider>
      <Lanes conversationId={conversationId} tree={tree.data} activeTimelineId={conversation.data?.activeTimelineId ?? null} onCompare={(a, b) => setPair([a, b])} />
    </ReactFlowProvider>
  )
}

function Lanes({ conversationId, tree, activeTimelineId, onCompare }: { conversationId: number; tree: NonNullable<ReturnType<typeof useTree>['data']>; activeTimelineId: number | null; onCompare: (a: number, b: number) => void }) {
  const openTab = useWorkspace((s) => s.openTab)
  const setActive = useSetActiveTimeline()
  const layout = useMemo(() => layoutBranches(tree), [tree])
  const [a, setA] = useState<number | ''>('')
  const [b, setB] = useState<number | ''>('')

  const nodes = useMemo<(MessageFlowNode | HeaderFlowNode)[]>(
    () => [
      ...layout.lanes.map<HeaderFlowNode>((l) => ({
        id: `lane${l.timelineId}`,
        type: 'lane',
        position: { x: l.x, y: -HEADER_HEIGHT },
        data: { name: l.name, summary: l.changeSummary, status: l.replayStatus, active: l.timelineId === activeTimelineId },
        draggable: false,
        selectable: true,
      })),
      ...layout.nodes.map<MessageFlowNode>((n) => ({
        id: n.id,
        type: 'message',
        position: { x: n.x, y: n.y },
        data: { node: n },
        draggable: false,
      })),
    ],
    [layout, activeTimelineId],
  )
  const edges = useMemo<Edge[]>(
    () => layout.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.crossLane ? 'smoothstep' : 'straight', style: e.crossLane ? { strokeDasharray: '5 3' } : undefined })),
    [layout],
  )

  const openTimeline = (timelineId: number) => {
    setActive.mutate({ id: conversationId, timelineId }, { onSuccess: () => openTab(makeTab('chat', conversationId)) })
  }

  const ready = a !== '' && b !== '' && a !== b
  return (
    <div className={styles.branches} data-testid="branches">
      <div className={styles.toolbar} role="toolbar" aria-label="Compare timelines">
        <span className={styles.muted}>Click a node or lane to open that timeline.</span>
        <span className={styles.spacer} />
        <Select size="small" aria-label="First timeline" value={String(a)} onChange={(e) => setA(e.target.value === '' ? '' : Number(e.target.value))}>
          <Select.Option value="">First timeline</Select.Option>
          {layout.lanes.map((l) => (
            <Select.Option key={l.timelineId} value={String(l.timelineId)}>
              {l.name}
            </Select.Option>
          ))}
        </Select>
        <Select size="small" aria-label="Second timeline" value={String(b)} onChange={(e) => setB(e.target.value === '' ? '' : Number(e.target.value))}>
          <Select.Option value="">Second timeline</Select.Option>
          {layout.lanes.map((l) => (
            <Select.Option key={l.timelineId} value={String(l.timelineId)}>
              {l.name}
            </Select.Option>
          ))}
        </Select>
        <Button size="small" disabled={!ready} onClick={() => ready && onCompare(a, b)}>
          Compare
        </Button>
      </div>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => {
            if (node.type === 'lane') openTimeline(Number(node.id.slice(4)))
            else openTimeline((node as MessageFlowNode).data.node.timelineId)
          }}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
        >
          <Background gap={24} color="#2a2c32" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {setActive.isError && <p role="alert">{setActive.error.message}</p>}
    </div>
  )
}
