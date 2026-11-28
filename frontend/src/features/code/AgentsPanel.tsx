import { useState } from 'react'
import Markdown from 'react-markdown'
import { codeComponents, rehypeCode, remarkMarkdown } from '../../components/codeMarkdown.ts'
import prose from '../../components/prose.module.css'
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react'
import type { AgentEntry, AgentStatus } from './model.ts'
import { ToolRow } from './Timeline.tsx'
import styles from './code.module.css'

const STATUS_LABEL: Record<AgentStatus, string> = { running: 'Running', done: 'Done', error: 'Failed', stopped: 'Ended' }
const noApproval = () => undefined

/**
 * Agents tab: the running subagents, each expandable to its own activity. Finished ones leave the list (like in the terminal);
 * they stay reachable under "Finished" and through "Show" in the timeline.
 */
export function AgentsPanel({ agents, expanded, onToggle }: { agents: AgentEntry[]; expanded: string | null; onToggle: (id: string) => void }) {
  const [showFinished, setShowFinished] = useState(false)
  const visible = agents.filter((a) => a.status === 'running' || a.id === expanded)
  const finished = agents.filter((a) => a.status !== 'running' && a.id !== expanded)
  return (
    <aside className={styles.panel} aria-label="Agents">
      <h3>Agents</h3>
      {visible.length === 0 && <p className={styles.note}>{agents.length === 0 ? 'No subagents started yet.' : 'No agent is running.'}</p>}
      <ul>
        {visible.map((a) => (
          <AgentRow key={a.id} agent={a} open={expanded === a.id} onToggle={() => onToggle(a.id)} />
        ))}
      </ul>
      {finished.length > 0 && (
        <>
          <button type="button" className={styles.resultToggle} aria-expanded={showFinished} onClick={() => setShowFinished(!showFinished)}>
            {showFinished ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />} Finished ({finished.length})
          </button>
          {showFinished && (
            <ul aria-label="Finished agents">
              {finished.map((a) => (
                <AgentRow key={a.id} agent={a} open={false} onToggle={() => onToggle(a.id)} />
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  )
}

function AgentRow({ agent, open, onToggle }: { agent: AgentEntry; open: boolean; onToggle: () => void }) {
  const [showPrompt, setShowPrompt] = useState(false)
  return (
    <li className={styles.agentRow} data-status={agent.status}>
      <button type="button" className={styles.agentHead} aria-expanded={open} onClick={onToggle}>
        <span className={styles.agentDot} data-status={agent.status} role="img" aria-label={STATUS_LABEL[agent.status]} />
        <span className={styles.agentTitle}>{agent.description || 'Agent'}</span>
        {agent.subagentType && <span className={styles.note}>{agent.subagentType}</span>}
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {open && (
        <div className={styles.agentBody}>
          {agent.prompt && (
            <>
              <button type="button" className={styles.resultToggle} aria-expanded={showPrompt} onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />} Prompt
              </button>
              {showPrompt && <pre className={styles.agentPrompt}>{agent.prompt}</pre>}
            </>
          )}
          <ol className={styles.agentItems} aria-label="Agent activity">
            {agent.items.map((item) =>
              item.kind === 'text' ? (
                <li key={item.key} className={`${styles.text} ${prose.prose}`}>
                  <Markdown remarkPlugins={remarkMarkdown} rehypePlugins={rehypeCode} components={codeComponents}>{item.text}</Markdown>
                </li>
              ) : (
                <ToolRow key={item.key} item={item} compact onApproval={noApproval} approvalBusy={false} />
              ),
            )}
          </ol>
          {agent.status === 'running' ? <p className={styles.note}>Working…</p> : <div className={styles.agentResult} data-error={agent.status === 'error' || undefined}>{agent.result || '(no output)'}</div>}
        </div>
      )}
    </li>
  )
}
