import { useState } from 'react'
import { IconButton } from '@primer/react'
import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import type { CodeSession } from '../../api/types.ts'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { PromptDialog } from '../../components/PromptDialog.tsx'
import { makeTab, selectActiveTab, useWorkspace } from '../../state/workspace.ts'
import cards from '../cards/cards.module.css'
import chat from '../chat/chat.module.css'
import { useCodeSessions, useCodeStatus, useDeleteSession, useRenameSession } from './hooks.ts'
import { NewSessionDialog } from './NewSessionDialog.tsx'
import { PlanUsageLine } from './PlanUsageLine.tsx'
import { STATUS_LABEL } from './model.ts'
import styles from './code.module.css'

/** Sidebar section of the Agent mode. */
export function SessionList() {
  const { data, isError, error } = useCodeSessions()
  const list = data ?? []
  const status = useCodeStatus()
  const openTab = useWorkspace((s) => s.openTab)
  const closeTab = useWorkspace((s) => s.closeTab)
  const activeId = useWorkspace((s) => selectActiveTab(s)?.id)
  const rename = useRenameSession()
  const remove = useDeleteSession()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<CodeSession | null>(null)
  const [deleting, setDeleting] = useState<CodeSession | null>(null)

  return (
    <section aria-label="Sessions" className={cards.convs}>
      <header className={cards.sectionHeader}>
        <span>Sessions</span>
        <IconButton icon={PlusIcon} size="small" variant="invisible" aria-label="New session" onClick={() => setCreating(true)} />
      </header>
      {status.data && !status.data.available && (
        <p className={cards.muted} role="alert">Claude Code is not available: {status.data.reason ?? 'unknown reason'}</p>
      )}
      {isError && <p className={cards.muted}>{error.message}</p>}
      {!isError && list.length === 0 && <p className={cards.muted}>No sessions yet.</p>}
      {list.map((s) => {
        const tab = makeTab('code', s.id)
        return (
          <div
            key={s.id}
            className={chat.convRow}
            style={{ paddingLeft: 12 }}
            data-active={activeId === tab.id || undefined}
            role="button"
            tabIndex={0}
            title={s.projectPath}
            onClick={() => openTab(tab)}
            onKeyDown={(e) => e.key === 'Enter' && openTab(tab)}
          >
            <span className={styles.dot} data-status={s.status} role="img" aria-label={STATUS_LABEL[s.status]} />
            <span className={chat.convTitle}>{s.title}</span>
            <span className={chat.convTools}>
              <IconButton icon={PencilIcon} size="small" variant="invisible" aria-label={`Rename ${s.title}`} onClick={(e) => { e.stopPropagation(); setRenaming(s) }} />
              <IconButton icon={TrashIcon} size="small" variant="invisible" aria-label={`Delete ${s.title}`} onClick={(e) => { e.stopPropagation(); setDeleting(s) }} />
            </span>
          </div>
        )
      })}
      <PlanUsageLine />
      {creating && <NewSessionDialog onClose={() => setCreating(false)} onCreated={(s) => openTab(makeTab('code', s.id))} />}
      {renaming && <PromptDialog title="Rename session" label="Title" initialValue={renaming.title} onClose={() => setRenaming(null)} onSubmit={(title) => rename.mutate({ id: renaming.id, title })} />}
      {deleting && (
        <ConfirmDialog
          title="Delete session?"
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => closeTab(makeTab('code', deleting.id).id) })}
        >
          “{deleting.title}” and its history will be deleted; a running turn is stopped. Cards it recorded stay.
        </ConfirmDialog>
      )}
    </section>
  )
}
