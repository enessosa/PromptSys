import type { ChangeEvent } from 'react'
import type { GitInfo, PermissionMode } from '../../api/types.ts'
import { CONTEXT_SEGMENTS, contextBar, folderName, formatTokens, MODE_HINT, MODE_LABEL, PERMISSION_MODES, type SessionState } from './model.ts'
import styles from './code.module.css'

type Props = {
  projectPath: string
  state: SessionState
  git: GitInfo | undefined
  onMode: (mode: PermissionMode) => void
  /** While the agent works the line shows how to interrupt it. */
  busy?: boolean
}

/** Like Claude Code's status line: model, folder, git branch, context usage and the permission mode (changeable). Plan limits are account-wide and shown in the session list. */
export function StatusLine({ projectPath, state, git, onMode, busy = false }: Props) {
  const mode = state.permissionMode
  const context = state.context
  const tk = state.tokens
  const tokensTotal = tk.input + tk.output + tk.cacheRead + tk.cacheCreation
  return (
    <div className={styles.statusLine} role="group" aria-label="Session status">
      {state.model && <span title="Model">{state.model}</span>}
      <span className={styles.pathText} title={projectPath}>{folderName(projectPath)}</span>
      {git?.isGitRepo && git.branch && (
        <span title={git.dirty ? 'Uncommitted changes' : 'Clean'}>
          {git.branch}
          {git.dirty ? '*' : ''}
        </span>
      )}
      {context ? <ContextItem context={context} /> : <span title="Context window usage appears after the first turn">Context –</span>}
      {tokensTotal > 0 && (
        <span title={`In ${tk.input.toLocaleString()} · Out ${tk.output.toLocaleString()} · Cache read ${tk.cacheRead.toLocaleString()} · Cache write ${tk.cacheCreation.toLocaleString()}`}>Tokens {formatTokens(tokensTotal)}</span>
      )}
      <span className={styles.spacer} />
      {busy && <span className={styles.escHint}>Esc to interrupt</span>}
      <label className={styles.modeSelect} data-active={mode !== 'default' || undefined} title={`${MODE_HINT[mode]} (Shift+Tab cycles)`}>
        <span className={styles.srOnly}>Permission mode</span>
        <select aria-label="Permission mode" value={mode} onChange={(e: ChangeEvent<HTMLSelectElement>) => onMode(e.target.value as PermissionMode)}>
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function ContextItem({ context }: { context: NonNullable<SessionState['context']> }) {
  const { filled, level } = contextBar(context.percentage)
  return (
    <span title={`${context.totalTokens.toLocaleString()} of ${context.maxTokens.toLocaleString()} tokens`}>
      Context
      <span className={styles.ctxBar} data-level={level} data-testid="context-bar" aria-hidden="true">
        {Array.from({ length: CONTEXT_SEGMENTS }, (_, i) => (
          <i key={i} data-on={i < filled || undefined} />
        ))}
      </span>
      {Math.round(context.percentage)}%
    </span>
  )
}

