import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { IconButton } from '@primer/react'
import { CommentDiscussionIcon, GitBranchIcon, PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { api } from '../../api/client.ts'
import type { Conversation, ConversationTree } from '../../api/types.ts'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { PromptDialog } from '../../components/PromptDialog.tsx'
import { Toast } from '../../components/Toast.tsx'
import { makeTab, selectActiveTab, useWorkspace } from '../../state/workspace.ts'
import { useConversations } from '../cards/hooks.ts'
import cards from '../cards/cards.module.css'
import styles from './chat.module.css'
import { chatKeys, useBackendDown, useDeleteConversation, useNewConversation, useRenameConversation, useSetActiveTimeline } from './hooks.ts'

export function ConversationList() {
  const { data } = useConversations()
  const list = data ?? []
  const backendDown = useBackendDown()
  const trees = useQueries({
    queries: list.map((c) => ({
      queryKey: chatKeys.tree(c.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api<ConversationTree>(`/api/conversations/${c.id}/tree`, { signal }),
    })),
  })
  const openTab = useWorkspace((s) => s.openTab)
  const closeTab = useWorkspace((s) => s.closeTab)
  const forgetChat = useWorkspace((s) => s.forgetChat)
  const activeId = useWorkspace((s) => selectActiveTab(s)?.id)
  const newConversation = useNewConversation()
  const rename = useRenameConversation()
  const remove = useDeleteConversation()
  const setActive = useSetActiveTimeline()
  const [renaming, setRenaming] = useState<Conversation | null>(null)
  const [deleting, setDeleting] = useState<Conversation | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <section aria-label="Conversations" className={cards.convs}>
      <header className={cards.sectionHeader}>
        <span>Conversations</span>
        <IconButton icon={PlusIcon} size="small" variant="invisible" aria-label="New conversation" onClick={newConversation} />
      </header>
      {list.length === 0 && <p className={cards.muted}>{backendDown ? 'Backend offline, waiting for it…' : 'No conversations yet.'}</p>}
      {list.map((c, i) => {
        const tab = makeTab('chat', c.id)
        const tree = trees[i]?.data
        // The first timeline is the main line; every other one is a branch (regenerated answers, replays).
        const branches = tree && tree.timelines.length > 1 ? tree.timelines.slice(1) : []
        const activeTimeline = c.activeTimelineId ?? tree?.timelines[0]?.id
        return (
          <div key={c.id}>
            <div
              className={styles.convRow}
              style={{ paddingLeft: 12 }}
              data-active={activeId === tab.id || undefined}
              role="button"
              tabIndex={0}
              onClick={() => openTab(tab, { preview: true })}
              onDoubleClick={() => openTab(tab)}
              onKeyDown={(e) => e.key === 'Enter' && openTab(tab)}
            >
              <CommentDiscussionIcon size={14} />
              <span className={styles.convTitle}>{c.title}</span>
              <span className={styles.convTools}>
                <IconButton icon={GitBranchIcon} size="small" variant="invisible" aria-label={`Open branch view of ${c.title}`} onClick={(e) => { e.stopPropagation(); openTab(makeTab('branches', c.id)) }} />
                <IconButton icon={PencilIcon} size="small" variant="invisible" aria-label={`Rename ${c.title}`} onClick={(e) => { e.stopPropagation(); setRenaming(c) }} />
                <IconButton icon={TrashIcon} size="small" variant="invisible" aria-label={`Delete ${c.title}`} onClick={(e) => { e.stopPropagation(); setDeleting(c) }} />
              </span>
            </div>
            {tree && tree.timelines.length > 1 && (
              <>
                <BranchRow
                  label="main"
                  summary={null}
                  active={activeTimeline === tree.timelines[0].id}
                  onOpen={() => {
                    setActive.mutate({ id: c.id, timelineId: tree.timelines[0].id })
                    openTab(tab)
                  }}
                />
                {branches.map((t) => (
                  <BranchRow
                    key={t.id}
                    label={t.name}
                    summary={t.changeSummary}
                    active={activeTimeline === t.id}
                    onOpen={() => {
                      setActive.mutate({ id: c.id, timelineId: t.id })
                      openTab(tab)
                    }}
                  />
                ))}
              </>
            )}
          </div>
        )
      })}
      {renaming && (
        <PromptDialog
          title="Rename conversation"
          label="Title"
          initialValue={renaming.title}
          onClose={() => setRenaming(null)}
          onSubmit={(title) => rename.mutate({ id: renaming.id, title })}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete conversation?"
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                closeTab(makeTab('chat', deleting.id).id)
                forgetChat(deleting.id)
              },
              onError: (e) => setNotice(e.message),
            })
          }
        >
          “{deleting.title}” and all its messages and branches will be deleted. The cards stay. This cannot be undone.
        </ConfirmDialog>
      )}
      {notice && <Toast onClose={() => setNotice(null)} duration={5000}>{notice}</Toast>}
    </section>
  )
}

function BranchRow({ label, summary, active, onOpen }: { label: string; summary: string | null; active: boolean; onOpen: () => void }) {
  return (
    <div
      className={`${styles.convRow} ${styles.branchRow}`}
      style={{ paddingLeft: 30 }}
      data-active={active || undefined}
      role="button"
      tabIndex={0}
      aria-label={`Branch ${label}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <GitBranchIcon size={12} />
      <span className={styles.convTitle}>{summary ? `${label} · ${summary}` : label}</span>
    </div>
  )
}
