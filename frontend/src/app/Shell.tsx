import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { IconButton } from '@primer/react'
import {
  CommentDiscussionIcon,
  FileIcon,
  GearIcon,
  GitBranchIcon,
  RepoForkedIcon,
  SearchIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  XIcon,
  ColumnsIcon,
} from '@primer/octicons-react'
import { Button } from '@primer/react'
import { EmptyState } from '../components/EmptyState.tsx'
import { CardEditor } from '../features/cards/CardEditor.tsx'
import { CardTree } from '../features/cards/CardTree.tsx'
import { LinkList } from '../features/cards/LinkList.tsx'
import { useCard } from '../features/cards/hooks.ts'
import { ChatInspector } from '../features/chat/ChatInspector.tsx'
import { ChatView } from '../features/chat/ChatView.tsx'
import { ConversationList } from '../features/chat/ConversationList.tsx'
import { useBackendDown, useConversation, useHealth } from '../features/chat/hooks.ts'
import { Toast } from '../components/Toast.tsx'
import { WhyHost } from '../features/ablation/WhyDialog.tsx'
import { CodeSessionView } from '../features/code/SessionView.tsx'
import { SessionList } from '../features/code/SessionList.tsx'
import { ModeSwitch } from '../features/code/ModeSwitch.tsx'
import { useMode } from '../features/code/hooks.ts'
import { BranchView } from '../features/branches/BranchView.tsx'
import { ApiKeyButton } from '../features/settings/ApiKeyButton.tsx'
import { SettingsView } from '../features/settings/SettingsView.tsx'
import { useSettings } from '../features/settings/hooks.ts'
import { applyAccent } from '../features/settings/accent.ts'
import { GraphView } from '../features/graph/GraphView.tsx'
import { MergeToast } from '../features/graph/MergeToast.tsx'
import { CommandPalette } from '../features/palette/CommandPalette.tsx'
import { useOpenBranchView } from '../features/branches/useOpenBranchView.ts'
import { useCommands, useGlobalShortcuts } from '../features/palette/useCommands.ts'
import { makeTab, selectActiveTab, useWorkspace, type Pane, type Tab } from '../state/workspace.ts'
import { useTabTitle } from './useTabTitle.ts'
import { useUrlTabSync } from './routes.tsx'
import styles from './Shell.module.css'

export function Shell() {
  useUrlTabSync()
  const commands = useCommands()
  useGlobalShortcuts(commands)
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen)
  const inspectorOpen = useWorkspace((s) => s.inspectorOpen)
  const { claudeCode } = useMode()
  const accent = useSettings().data?.accentColor
  useEffect(() => {
    if (accent !== undefined) applyAccent(accent)
  }, [accent])

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Ribbon />
        <Group orientation="horizontal" id="shell" style={{ flex: 1, minWidth: 0 }}>
          {sidebarOpen && (
            <>
              <Panel id="sidebar" defaultSize="260px" minSize="180px" maxSize="480px">
                <aside className={styles.sidebar} aria-label="Sidebar">
                  <ModeSwitch />
                  <CardTree />
                  {claudeCode ? <SessionList /> : <ConversationList />}
                </aside>
              </Panel>
              <Separator className={styles.separator} />
            </>
          )}
          <Panel id="main" minSize="320px">
            <div style={{ position: 'relative', height: '100%' }}>
              <TabArea />
              <OfflineOverlay />
            </div>
          </Panel>
          {inspectorOpen && (
            <>
              <Separator className={styles.separator} />
              <Panel id="inspector" defaultSize="280px" minSize="200px" maxSize="520px">
                <Inspector />
              </Panel>
            </>
          )}
        </Group>
      </div>
      <StatusBar />
      <CommandPalette commands={commands} />
      <MergeToast />
      <WhyHost />
      <NoticeToast />
    </div>
  )
}

function Ribbon() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const openTab = useWorkspace((s) => s.openTab)
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)
  const activeType = useWorkspace((s) => selectActiveTab(s)?.type)
  const openBranchView = useOpenBranchView()
  return (
    <nav className={styles.ribbon} aria-label="Ribbon">
      <IconButton
        icon={sidebarOpen ? SidebarCollapseIcon : SidebarExpandIcon}
        variant="invisible"
        aria-label="Toggle sidebar"
        onClick={toggleSidebar}
      />
      <IconButton icon={FileIcon} variant="invisible" aria-label="Cards" data-active={sidebarOpen} onClick={toggleSidebar} />
      <IconButton
        icon={RepoForkedIcon}
        variant="invisible"
        aria-label="Graph"
        data-active={activeType === 'graph'}
        onClick={() => openTab(makeTab('graph'))}
      />
      <IconButton
        icon={GitBranchIcon}
        variant="invisible"
        aria-label="Branches"
        data-active={activeType === 'branches'}
        onClick={() => openBranchView()}
      />
      <IconButton icon={SearchIcon} variant="invisible" aria-label="Search" onClick={() => setPaletteOpen(true)} />
      <span className={styles.spacer} />
      <IconButton icon={CommentDiscussionIcon} variant="invisible" aria-label="Conversations" onClick={() => useWorkspace.getState().sidebarOpen || toggleSidebar()} />
      <IconButton icon={GearIcon} variant="invisible" aria-label="Settings" data-active={activeType === 'settings'} onClick={() => openTab(makeTab('settings'))} />
    </nav>
  )
}

function TabArea() {
  const panes = useWorkspace((s) => s.panes)
  return (
    <Group orientation="horizontal" id="panes" className={styles.main}>
      {panes.map((pane, i) => (
        <PaneSlot key={i} index={i} pane={pane} multi={panes.length > 1} last={i === panes.length - 1} />
      ))}
    </Group>
  )
}

function PaneSlot({ index, pane, multi, last }: { index: number; pane: Pane; multi: boolean; last: boolean }) {
  return (
    <>
      <Panel id={`pane-${index}`} minSize="240px">
        <PaneView index={index} pane={pane} multi={multi} />
      </Panel>
      {multi && !last && <Separator className={styles.separator} />}
    </>
  )
}

const TAB_DRAG = 'application/x-promptsys-tab'

function PaneView({ index, pane, multi }: { index: number; pane: Pane; multi: boolean }) {
  const activePane = useWorkspace((s) => s.activePane)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const activateTab = useWorkspace((s) => s.activateTab)
  const closeTab = useWorkspace((s) => s.closeTab)
  const moveTab = useWorkspace((s) => s.moveTab)
  const openTab = useWorkspace((s) => s.openTab)
  const active = pane.tabs.find((t) => t.id === pane.activeTabId)

  return (
    <section
      className={styles.pane}
      data-active={activePane === index}
      data-multi={multi}
      aria-label={`Pane ${index + 1}`}
      onMouseDown={() => setActivePane(index)}
      onDragOver={(e) => e.dataTransfer.types.includes(TAB_DRAG) && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(TAB_DRAG)
        if (id) moveTab(id, index)
      }}
    >
      <div className={styles.tabs} role="tablist">
        {pane.tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === pane.activeTabId}
            onSelect={() => activateTab(tab.id)}
            onPin={() => openTab(tab)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
        <div className={styles.tools}>
          {!multi && active && (
            <IconButton
              icon={ColumnsIcon}
              size="small"
              variant="invisible"
              aria-label="Move tab to second pane"
              onClick={() => moveTab(active.id, 1)}
            />
          )}
        </div>
      </div>
      <div className={styles.content} role="tabpanel">
        {active ? <TabContent tab={active} /> : <EmptyState title="Nothing open">Pick a card in the sidebar, or press {'Ctrl/Cmd+K'}.</EmptyState>}
      </div>
    </section>
  )
}

function TabButton({ tab, active, onSelect, onPin, onClose }: { tab: Tab; active: boolean; onSelect: () => void; onPin: () => void; onClose: () => void }) {
  const title = useTabTitle(tab)
  return (
    <div
      className={styles.tab}
      role="tab"
      aria-selected={active}
      data-active={active}
      data-preview={tab.preview || undefined}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(TAB_DRAG, tab.id)}
      onClick={onSelect}
      onDoubleClick={onPin}
      onAuxClick={(e) => e.button === 1 && onClose()}
    >
      <span className={styles.tabTitle}>{title}</span>
      <IconButton icon={XIcon} size="small" variant="invisible" aria-label={`Close ${title}`} onClick={(e) => { e.stopPropagation(); onClose() }} />
    </div>
  )
}

function TabContent({ tab }: { tab: Tab }) {
  if (tab.type === 'card') return <CardEditor cardId={tab.refId!} />
  if (tab.type === 'graph') return <GraphView />
  if (tab.type === 'branches') return <BranchView conversationId={tab.refId!} />
  if (tab.type === 'settings') return <SettingsView />
  if (tab.type === 'code') return <CodeSessionView sessionId={tab.refId!} />
  return <ChatView conversationId={tab.refId!} />
}

function Inspector() {
  const tab = useWorkspace(selectActiveTab)
  const selection = useWorkspace((s) => s.graphSelection)
  const openMerge = useWorkspace((s) => s.openMerge)
  const card = useCard(tab?.type === 'card' ? tab.refId : undefined)
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      {tab?.type === 'card' && card.data && (
        <>
          <h3>Links</h3>
          <LinkList card={card.data} />
        </>
      )}
      {tab?.type === 'graph' && (
        <>
          <h3>Selection</h3>
          <p>{selection.length} card(s) selected</p>
          <Button size="small" disabled={selection.length < 2} onClick={() => openMerge(selection)}>
            Merge selected
          </Button>
        </>
      )}
      {tab?.type === 'chat' && <ChatInspector conversationId={tab.refId!} />}
      {!tab && <p>Nothing selected.</p>}
    </aside>
  )
}

/** One clear state when the API is unreachable; everything refetches when the backend comes back. */
function OfflineOverlay() {
  const down = useBackendDown()
  const qc = useQueryClient()
  const wasDown = useRef(false)
  useEffect(() => {
    if (down) wasDown.current = true
    else if (wasDown.current) {
      wasDown.current = false
      void qc.invalidateQueries()
    }
  }, [down, qc])
  if (!down) return null
  return (
    <div className={styles.offline} role="alert">
      <EmptyState title="Backend not reachable">
        Backend not reachable on 127.0.0.1:8000 – start it with `npm run dev` in backend/. This page retries automatically.
      </EmptyState>
    </div>
  )
}

function NoticeToast() {
  const notice = useWorkspace((s) => s.notice)
  const setNotice = useWorkspace((s) => s.setNotice)
  const close = useCallback(() => setNotice(null), [setNotice])
  return notice ? <Toast onClose={close} duration={4000}>{notice}</Toast> : null
}

function StatusBar() {
  const health = useHealth()
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen)
  const chatId = useWorkspace((s) => {
    const tab = selectActiveTab(s)
    return tab?.type === 'chat' ? tab.refId! : null
  })
  const context = useWorkspace((s) => (chatId === null ? undefined : s.chatContexts[chatId]))
  const conversation = useConversation(chatId)
  const dialogCalls = useWorkspace((s) => s.expectedCalls)
  const sent = context?.items.filter((i) => i.state !== 'excluded').length ?? 0
  return (
    <footer className={styles.statusBar}>
      <span>{health.isError ? 'Backend offline' : health.data ? 'Backend ok' : 'Connecting…'}</span>
      {health.data && <span>{health.data.apiKeyConfigured ? 'API key ok' : 'No API key'}</span>}
      {health.data && !health.data.apiKeyConfigured && <ApiKeyButton variant="primary" size="small" />}
      {chatId !== null && conversation.data && <span>Model: {conversation.data.model ?? 'default'}</span>}
      {chatId !== null && conversation.data?.showDerivedRules && <span>Derived rules on: +1 API call per answer</span>}
      {dialogCalls !== null && <span role="status">Expected: {dialogCalls} API call{dialogCalls === 1 ? '' : 's'}</span>}
      {context && (
        <span>
          {sent} card{sent === 1 ? '' : 's'} in context{context.tokens !== null && ` · ~${context.tokens.toLocaleString('en')} tokens`}
        </span>
      )}
      <button className={`${styles.right}`} style={{ all: 'unset', cursor: 'pointer' }} onClick={() => setPaletteOpen(true)}>
        <kbd>Ctrl/Cmd+K</kbd>
      </button>
    </footer>
  )
}
