import { useState } from 'react'
import { Button } from '@primer/react'
import { SyncIcon } from '@primer/octicons-react'
import { useChanges } from './hooks.ts'
import styles from './code.module.css'

const SIGN: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U', renamed: 'R' }

function DiffView({ diff, truncated }: { diff: string; truncated: boolean }) {
  if (!diff) return <p className={styles.note}>No textual diff (binary or empty file).</p>
  return (
    <>
      <pre className={styles.diff} aria-label="Diff">
        {diff.split('\n').map((line, i) => (
          <span key={i} className={styles.diffLine} data-kind={line.startsWith('+++') || line.startsWith('---') ? 'meta' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line.startsWith('@@') ? 'hunk' : undefined}>
            {line || ' '}
          </span>
        ))}
      </pre>
      {truncated && <p className={styles.note}>Diff truncated (too large).</p>}
    </>
  )
}

/** Uncommitted changes of the project (like Claude Code's /diff): file list with +/- counts, click a file for its diff. */
export function ChangesPanel({ sessionId, turns }: { sessionId: number; turns: number }) {
  const changes = useChanges(sessionId, turns, true)
  const [selected, setSelected] = useState<string | null>(null)
  const files = changes.data?.files ?? []
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  const current = files.find((f) => f.path === selected)

  return (
    <aside className={`${styles.panel} ${styles.changes}`} aria-label="Changes">
      <div className={styles.changesHead}>
        <h3>Changes</h3>
        <Button size="small" variant="invisible" aria-label="Refresh changes" leadingVisual={SyncIcon} disabled={changes.isFetching} onClick={() => void changes.refetch()} />
      </div>
      {changes.isPending && <p className={styles.note}>Loading…</p>}
      {changes.isError && <p role="alert" className={styles.error}>{changes.error.message}</p>}
      {changes.data && !changes.data.isGitRepo && <p className={styles.note}>This folder is not a git repository.</p>}
      {changes.data?.isGitRepo && (
        <>
          <p className={styles.changesSummary}>
            {files.length === 0 ? (
              'No changes'
            ) : (
              <>
                {files.length} {files.length === 1 ? 'file' : 'files'} changed <span className={styles.plus}>+{added}</span> <span className={styles.minus}>−{removed}</span>
              </>
            )}
          </p>
          <ul aria-label="Changed files">
            {files.map((f) => (
              <li key={f.path}>
                <button type="button" className={styles.fileRow} aria-pressed={f.path === selected} onClick={() => setSelected(f.path === selected ? null : f.path)} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                  <span className={styles.fileStatus} data-status={f.status}>{SIGN[f.status]}</span>
                  <span className={styles.filePath}>{f.path}</span>
                  <span className={styles.plus}>+{f.added}</span>
                  <span className={styles.minus}>−{f.removed}</span>
                </button>
              </li>
            ))}
          </ul>
          {current && <DiffView diff={current.diff} truncated={current.truncated} />}
        </>
      )}
    </aside>
  )
}
