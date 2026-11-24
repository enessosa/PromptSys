import { useMemo, useRef, useState, type DragEvent } from 'react'
import { IconButton, TextInput } from '@primer/react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FileDirectoryIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from '@primer/octicons-react'
import type { CardSummary } from '../../api/types.ts'
import { ContextMenu, type MenuItem } from '../../components/ContextMenu.tsx'
import { HoverCard } from '../../components/HoverCard.tsx'
import { useBackendDown } from '../chat/hooks.ts'
import { PromptDialog } from '../../components/PromptDialog.tsx'
import { makeTab, selectActiveTab, useWorkspace } from '../../state/workspace.ts'
import { CardPreview } from './CardPreview.tsx'
import { useArchiveCard, useCards, useCreateCard, useUpdateCard, useUploadCard } from './hooks.ts'
import { buildTree, cardLabel, KIND_COLORS, type TreeFolder } from './model.ts'
import styles from './cards.module.css'

type Dialog = { kind: 'rename' | 'move'; card: CardSummary } | null
type Menu = { x: number; y: number; card: CardSummary } | null

export function CardTree() {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<Menu>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const { data: cards, isPending, isError } = useCards()
  const backendDown = useBackendDown()
  const create = useCreateCard()
  const update = useUpdateCard()
  const archive = useArchiveCard()
  const upload = useUploadCard()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const openTab = useWorkspace((s) => s.openTab)
  const closeTab = useWorkspace((s) => s.closeTab)
  const activeId = useWorkspace((s) => selectActiveTab(s)?.id)

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!cards) return []
    if (!q) return cards
    return cards.filter((c) => c.title.toLowerCase().includes(q) || cardLabel(c.id) === q)
  }, [cards, filter])
  const tree = useMemo(() => buildTree(visible), [visible])

  const open = (card: { id: number }, preview: boolean) => openTab(makeTab('card', card.id), { preview })

  const newCard = (folderPath = '') =>
    create.mutate({ title: 'Untitled', folderPath }, { onSuccess: (card) => open(card, false) })

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const onDrop = (e: DragEvent, folderPath: string) => {
    e.preventDefault()
    setDropTarget(null)
    const id = Number(e.dataTransfer.getData('application/x-promptsys-card'))
    const card = cards?.find((c) => c.id === id)
    if (card && card.folderPath !== folderPath) update.mutate({ id, folderPath })
  }

  const menuItems = (card: CardSummary): MenuItem[] => [
    { label: 'Open', onSelect: () => open(card, false) },
    { label: 'Open in second pane', onSelect: () => openTab(makeTab('card', card.id), { pane: 1 }) },
    { separator: true },
    { label: 'Rename…', onSelect: () => setDialog({ kind: 'rename', card }) },
    { label: 'Move to folder…', onSelect: () => setDialog({ kind: 'move', card }) },
    { separator: true },
    {
      label: 'Archive',
      danger: true,
      onSelect: () =>
        archive.mutate(card.id, { onSuccess: () => closeTab(makeTab('card', card.id).id) }),
    },
  ]

  const renderFolder = (folder: TreeFolder, depth: number) =>
    folder.children.map((node) => {
      if (node.type === 'folder') {
        const isCollapsed = collapsed.has(node.path) && !filter
        return (
          <div key={`f:${node.path}`}>
            <div
              className={styles.row}
              data-drop={dropTarget === node.path || undefined}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => toggle(node.path)}
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget(node.path)
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => onDrop(e, node.path)}
              role="treeitem"
              aria-expanded={!isCollapsed}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && toggle(node.path)}
            >
              {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
              <FileDirectoryIcon size={14} />
              <span className={styles.name}>{node.name}</span>
            </div>
            {!isCollapsed && renderFolder(node, depth + 1)}
          </div>
        )
      }
      const card = node.card
      const tabId = makeTab('card', card.id).id
      return (
        <HoverCard key={card.id} content={<CardPreview id={card.id} />}>
          <div
            className={styles.row}
            data-active={activeId === tabId || undefined}
            style={{ paddingLeft: 22 + depth * 14 }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/x-promptsys-card', String(card.id))}
            onClick={() => open(card, true)}
            onDoubleClick={() => open(card, false)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, card })
            }}
            role="treeitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && open(card, false)}
          >
            <span className={styles.dot} style={{ background: KIND_COLORS[card.kind] }} title={card.kind} />
            <span className={styles.label}>{cardLabel(card.id)}</span>
            <span className={styles.name}>{card.title}</span>
          </div>
        </HoverCard>
      )
    })

  return (
    <section className={styles.tree} aria-label="Cards">
      <header className={styles.sectionHeader}>
        <span>Cards</span>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt,.text,.log,.json,.yaml,.yml,.toml,.csv,.tsv,.xml,.html,.css,.ini,.sql,.sh,.js,.mjs,.ts,.tsx,.jsx,.py,.java,.kt,.go,.rs,.c,.h,.cpp,.cs,.rb,.php,.swift,text/*"
          hidden
          aria-label="Upload file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setUploadError(null)
            upload.mutate(
              { file },
              { onSuccess: (card) => open(card, false), onError: (err) => setUploadError(err.message) },
            )
          }}
        />
        <IconButton
          icon={UploadIcon}
          size="small"
          variant="invisible"
          aria-label="Upload file"
          title="Text, Markdown, code, PDF, DOCX – max 10 MB"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
        />
        <IconButton
          icon={PlusIcon}
          size="small"
          variant="invisible"
          aria-label="New card"
          onClick={() => newCard()}
          disabled={create.isPending}
        />
      </header>
      <div className={styles.filter}>
        <TextInput
          block
          size="small"
          leadingVisual={SearchIcon}
          placeholder="Filter cards"
          aria-label="Filter cards"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div
        role="tree"
        className={styles.rows}
        data-drop={dropTarget === '' || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDropTarget('')
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDrop(e, '')}
      >
        {uploadError && <p className={styles.muted} role="alert">{uploadError}</p>}
        {isPending && <p className={styles.muted}>Loading…</p>}
        {isError && <p className={styles.muted}>{backendDown ? 'Backend offline, waiting for it…' : 'Cards could not be loaded.'}</p>}
        {cards && visible.length === 0 && (
          <p className={styles.muted}>{filter ? 'No matching cards.' : 'No cards yet. Create one with +.'}</p>
        )}
        {renderFolder(tree, 0)}
        {!isPending && !isError && (
          <div className={styles.row} style={{ paddingLeft: 8 }} role="none">
            <FileIcon size={14} />
            <button className={styles.linkButton} onClick={() => newCard()}>
              New card
            </button>
          </div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.card)} onClose={() => setMenu(null)} />}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename card"
          label="Title"
          initialValue={dialog.card.title}
          onClose={() => setDialog(null)}
          onSubmit={(title) => update.mutate({ id: dialog.card.id, title })}
        />
      )}
      {dialog?.kind === 'move' && (
        <PromptDialog
          title="Move card"
          label="Folder (e.g. project/api, empty = root)"
          initialValue={dialog.card.folderPath}
          allowEmpty
          confirmLabel="Move"
          onClose={() => setDialog(null)}
          onSubmit={(folderPath) => update.mutate({ id: dialog.card.id, folderPath })}
        />
      )}
    </section>
  )
}
