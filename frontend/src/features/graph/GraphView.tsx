import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type OnNodesChange,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button, Select, TextInput } from '@primer/react'
import { ApiError } from '../../api/client.ts'
import { CARD_KINDS, LINK_KINDS, type CardKind, type GraphDto, type Link } from '../../api/types.ts'
import { ContextMenu, type MenuItem } from '../../components/ContextMenu.tsx'
import { EmptyState } from '../../components/EmptyState.tsx'
import { PromptDialog } from '../../components/PromptDialog.tsx'
import { Toast } from '../../components/Toast.tsx'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { useArchiveCard, useCards, useCreateLink, useDeleteLink, useUpdateLink } from '../cards/hooks.ts'
import { CardNode } from './CardNode.tsx'
import { inFolder, matchesText, type GraphFilters } from './filters.ts'
import type { CardFlowNode } from './nodeModel.ts'
import { useGraph, useSavePositions } from './hooks.ts'
import { computeLayout } from './layout.ts'
import { MergeDialog } from './MergeDialog.tsx'
import styles from './graph.module.css'

const nodeTypes = { card: CardNode }
const HOLD_TO_MERGE_MS = 600
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1 }

type Side = 'top' | 'right' | 'bottom' | 'left'

/** Picks the facing sides of two cards from their relative position (dominant axis wins). */
function pickSides(from: { x: number; y: number }, to: { x: number; y: number }): [Side, Side] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export function GraphView() {
  const { data, isPending, error } = useGraph()
  if (isPending) return <EmptyState title="Loading graph…" />
  if (error) return <EmptyState title="Graph could not be loaded">{error.message}</EmptyState>
  return (
    <ReactFlowProvider>
      <GraphCanvas data={data} />
    </ReactFlowProvider>
  )
}

function buildNodes(data: GraphDto, prev: CardFlowNode[], plan: Map<number, { x: number; y: number }>): CardFlowNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  return data.nodes.map((n) => {
    const old = prevById.get(String(n.id))
    const position =
      old?.position ?? (n.x !== null && n.y !== null ? { x: n.x, y: n.y } : (plan.get(n.id) ?? { x: 0, y: 0 }))
    return {
      id: String(n.id),
      type: 'card' as const,
      position,
      selected: old?.selected,
      data: {
        cardId: n.id,
        title: n.title,
        kind: n.kind,
        degree: n.degree,
        origin: n.origin ?? null,
        reviewStatus: n.reviewStatus ?? null,
        inContext: n.inContext ?? false,
        dimmed: false,
      },
    }
  })
}

function GraphCanvas({ data }: { data: GraphDto }) {
  const { fitView, getIntersectingNodes } = useReactFlow<CardFlowNode>()
  const openTab = useWorkspace((s) => s.openTab)
  const setGraphSelection = useWorkspace((s) => s.setGraphSelection)
  const mergeIds = useWorkspace((s) => s.mergeIds)
  const openMerge = useWorkspace((s) => s.openMerge)
  const closeMerge = useWorkspace((s) => s.closeMerge)
  const addToChatContext = useWorkspace((s) => s.addToChatContext)

  const createLink = useCreateLink()
  const updateLink = useUpdateLink()
  const deleteLink = useDeleteLink()
  const archive = useArchiveCard()
  const savePositions = useSavePositions()
  const { mutate: persistPositions } = savePositions

  const plan = useMemo(() => computeLayout(data.nodes, data.links), [data])
  const [nodes, setNodes] = useState<CardFlowNode[]>(() => buildNodes(data, [], plan))
  const [seen, setSeen] = useState(data)
  if (seen !== data) {
    setSeen(data)
    setNodes((prev) => buildNodes(data, prev, plan))
  }

  // Newly placed nodes get their computed position stored once, so the graph stays where it is.
  const stored = useRef(new Set<number>())
  useEffect(() => {
    const fresh = [...plan].filter(([id]) => !stored.current.has(id))
    if (fresh.length === 0) return
    fresh.forEach(([id]) => stored.current.add(id))
    persistPositions(fresh.map(([id, p]) => ({ id, ...p })))
  }, [plan, persistPositions])

  // The layout is computed synchronously, but node sizes are measured after the first paint: fit again then.
  const nodeCount = data.nodes.length
  useEffect(() => {
    const frame = requestAnimationFrame(() => void fitView(FIT_OPTIONS))
    return () => cancelAnimationFrame(frame)
  }, [nodeCount, fitView])

  const [filters, setFilters] = useState<GraphFilters>({ kind: '', folder: '', text: '' })
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; link: Link } | null>(null)
  const [labelFor, setLabelFor] = useState<Link | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const dragHover = useRef<{ id: string; since: number } | null>(null)

  useEffect(() => () => setGraphSelection([]), [setGraphSelection])

  const folders = useMemo(() => [...new Set(data.nodes.map((n) => n.folderPath).filter(Boolean))].sort(), [data])

  const visibleIds = useMemo(
    () =>
      new Set(
        data.nodes
          .filter((n) => (!filters.kind || n.kind === filters.kind) && inFolder(n.folderPath, filters.folder))
          .map((n) => String(n.id)),
      ),
    [data, filters.kind, filters.folder],
  )

  // Cards of the current chat context (client side; the backend does not report `inContext`).
  const contextIds = useWorkspace((s) => (s.lastChatId === null ? undefined : s.chatContexts[s.lastChatId]?.items))
  const contextSet = useMemo(() => new Set((contextIds ?? []).filter((i) => i.state !== 'excluded').map((i) => i.cardId)), [contextIds])

  // The graph endpoint may not report the review state; the card list does.
  const cardList = useCards().data
  const agentInfo = useMemo(() => new Map((cardList ?? []).filter((c) => c.origin).map((c) => [c.id, c])), [cardList])

  const shownNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        hidden: !visibleIds.has(n.id),
        data: {
          ...n.data,
          origin: n.data.origin ?? agentInfo.get(n.data.cardId)?.origin ?? null,
          reviewStatus: n.data.reviewStatus ?? agentInfo.get(n.data.cardId)?.reviewStatus ?? null,
          inContext: n.data.inContext || contextSet.has(n.data.cardId),
          dimmed: !matchesText({ id: n.data.cardId, title: n.data.title }, filters.text),
        },
      })),
    [nodes, visibleIds, filters.text, contextSet, agentInfo],
  )

  const edges = useMemo<Edge[]>(
    () =>
      data.links.map((l) => {
        const from = nodes.find((n) => n.id === String(l.sourceId))
        const to = nodes.find((n) => n.id === String(l.targetId))
        const [sourceHandle, targetHandle] = from && to ? pickSides(from.position, to.position) : ['right', 'left']
        return {
        id: `l${l.id}`,
        source: String(l.sourceId),
        target: String(l.targetId),
        sourceHandle,
        targetHandle,
        label: l.label ?? undefined,
        selected: selectedEdge === l.id,
        hidden: !visibleIds.has(String(l.sourceId)) || !visibleIds.has(String(l.targetId)),
        markerEnd: l.kind === 'related' ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: l.kind === 'contradicts' ? { strokeDasharray: '4 3' } : undefined,
        data: { link: l },
        }
      }),
    [data.links, nodes, selectedEdge, visibleIds],
  )

  const selectedIds = nodes.filter((n) => n.selected && visibleIds.has(n.id)).map((n) => Number(n.id))

  const onNodesChange = useCallback<OnNodesChange<CardFlowNode>>(
    (changes) => setNodes((prev) => changes.applyTo(prev)),
    [],
  )
  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams<CardFlowNode>) => setGraphSelection(sel.map((n) => Number(n.id))),
    [setGraphSelection],
  )

  const onConnect = (c: Connection) => {
    const sourceId = Number(c.source)
    const targetId = Number(c.target)
    if (sourceId === targetId) return
    createLink.mutate(
      { sourceId, targetId },
      {
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'link_exists') {
            const existing = data.links.find(
              (l) =>
                (l.sourceId === sourceId && l.targetId === targetId) ||
                (l.sourceId === targetId && l.targetId === sourceId),
            )
            if (existing) setSelectedEdge(existing.id)
            setNotice('These cards are already linked.')
          } else {
            setNotice(e.message)
          }
        },
      },
    )
  }

  const onDragStop = (_: unknown, node: CardFlowNode, dragged: CardFlowNode[]) => {
    const hover = dragHover.current
    dragHover.current = null
    if (hover && Date.now() - hover.since >= HOLD_TO_MERGE_MS) {
      // Dropped onto another node after holding: shortcut for "merge these two".
      openMerge([Number(hover.id), Number(node.id)])
      return
    }
    persistPositions(dragged.map((n) => ({ id: Number(n.id), x: Math.round(n.position.x), y: Math.round(n.position.y) })))
  }

  const onDrag = (_: unknown, node: CardFlowNode) => {
    const over = getIntersectingNodes(node).find((n) => n.id !== node.id)
    if (!over) dragHover.current = null
    else if (dragHover.current?.id !== over.id) dragHover.current = { id: over.id, since: Date.now() }
  }

  const relayout = () => {
    const all = computeLayout(
      nodes.map((n) => ({ id: n.data.cardId, x: null, y: null })),
      data.links,
      { all: true },
    )
    setNodes((prev) => prev.map((n) => ({ ...n, position: all.get(n.data.cardId) ?? n.position })))
    persistPositions([...all].map(([id, p]) => ({ id, ...p })))
    requestAnimationFrame(() => void fitView({ ...FIT_OPTIONS, duration: 250 }))
  }

  const edgeMenu = (link: Link): MenuItem[] => [
    { label: 'Edit label…', onSelect: () => setLabelFor(link) },
    { separator: true },
    ...LINK_KINDS.map((kind) => ({
      label: `${kind === link.kind ? '✓ ' : ''}Kind: ${kind.replace('_', ' ')}`,
      onSelect: () => kind !== link.kind && updateLink.mutate({ id: link.id, kind }),
    })),
    { separator: true },
    { label: 'Delete link', danger: true, onSelect: () => deleteLink.mutate(link.id) },
  ]

  if (data.nodes.length === 0) {
    return <EmptyState title="No cards yet">Create cards in the sidebar; they show up here as nodes.</EmptyState>
  }

  return (
    <div className={styles.graph} data-testid="graph">
      <ReactFlow<CardFlowNode>
        nodes={shownNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onNodeDrag={onDrag}
        onNodeDragStop={onDragStop}
        onNodeDoubleClick={(_, n) => openTab(makeTab('card', Number(n.id)))}
        onNodeClick={() => setSelectedEdge(null)}
        onEdgeClick={(_, e) => setSelectedEdge(Number(e.id.slice(1)))}
        onEdgeContextMenu={(ev, e) => {
          ev.preventDefault()
          setMenu({ x: ev.clientX, y: ev.clientY, link: (e.data as { link: Link }).link })
        }}
        onPaneClick={() => setSelectedEdge(null)}
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      >
        <Background gap={24} color="#2a2c32" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable maskColor="rgb(0 0 0 / 0.5)" nodeColor="#3a3d46" />
      </ReactFlow>

      <div className={styles.filterBar} role="search">
        <TextInput
          size="small"
          aria-label="Find card"
          placeholder="Find card or c-number"
          value={filters.text}
          onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
        />
        <Select size="small" aria-label="Kind filter" value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as CardKind | '' }))}>
          <Select.Option value="">All kinds</Select.Option>
          {CARD_KINDS.map((k) => (
            <Select.Option key={k} value={k}>
              {k}
            </Select.Option>
          ))}
        </Select>
        <Select size="small" aria-label="Folder filter" value={filters.folder} onChange={(e) => setFilters((f) => ({ ...f, folder: e.target.value }))}>
          <Select.Option value="">All folders</Select.Option>
          {folders.map((f) => (
            <Select.Option key={f} value={f}>
              {f}
            </Select.Option>
          ))}
        </Select>
        <Button size="small" onClick={relayout}>
          Re-layout
        </Button>
      </div>

      {selectedIds.length >= 1 && (
        <div className={styles.selectionBar} role="toolbar" aria-label="Selection">
          <span>{selectedIds.length} selected</span>
          <Button
            size="small"
            onClick={() =>
              setNotice(
                addToChatContext(selectedIds)
                  ? `${selectedIds.length} card${selectedIds.length === 1 ? '' : 's'} added to the context.`
                  : 'Open a conversation first.',
              )
            }
          >
            Add to context
          </Button>
          <Button size="small" variant="primary" disabled={selectedIds.length < 2} onClick={() => openMerge(selectedIds)}>
            Merge
          </Button>
          <Button size="small" variant="danger" onClick={() => selectedIds.forEach((id) => archive.mutate(id))}>
            Archive
          </Button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={edgeMenu(menu.link)} onClose={() => setMenu(null)} />}
      {labelFor && (
        <PromptDialog
          title="Link label"
          label="Label (empty removes it)"
          initialValue={labelFor.label ?? ''}
          allowEmpty
          onClose={() => setLabelFor(null)}
          onSubmit={(label) => updateLink.mutate({ id: labelFor.id, label: label || null })}
        />
      )}
      {mergeIds && <MergeDialog cardIds={mergeIds} onClose={closeMerge} />}
      {notice && <Toast onClose={() => setNotice(null)} duration={4000}>{notice}</Toast>}
    </div>
  )
}
