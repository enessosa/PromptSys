import { useState, type ReactNode } from 'react'
import { Button } from '@primer/react'
import Markdown from 'react-markdown'
import { AlertIcon, CheckIcon, InfoIcon, ChevronDownIcon, ChevronRightIcon, XIcon } from '@primer/octicons-react'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { cardLabel } from '../cards/model.ts'
import { CardRefChip } from '../chat/CitationChip.tsx'
import { describeInput, isAgentTool, splitCardRefs, isPath, isPathInput, summarizeResult, type TimelineItem, type ToolItem } from './model.ts'
import { codeComponents, rehypeCode } from '../../components/codeMarkdown.ts'
import styles from './code.module.css'

type Props = {
  items: TimelineItem[]
  onApproval: (approvalId: string, allow: boolean) => void
  approvalBusy: boolean
  /** Runs a slash command offered in a notice; only commands that exist in this session are offered. */
  onCommand?: (command: string) => void
  availableCommands?: string[]
  /** Opens the Agents tab with this agent expanded. */
  onShowAgent?: (id: string) => void
}

const pretty = (v: unknown) => {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** Inline code that looks like a path gets the path colour; code blocks (with a language class or newlines) stay as they are. */
function InlineCode({ className, children }: { className?: string; children?: ReactNode }) {
  const text = typeof children === 'string' ? children : ''
  const path = !className && !text.includes('\n') && isPath(text)
  return (
    <code className={path ? styles.pathText : className}>{children}</code>
  )
}

const markdownComponents = { ...codeComponents, code: InlineCode }

/** One row per tool call: name and input, the approval (buttons while pending, then a badge) and the result, collapsed to one line. */
export function ToolRow({ item, onApproval, approvalBusy, compact = false, onShowAgent }: { item: ToolItem; onApproval: Props['onApproval']; approvalBusy: boolean; compact?: boolean; onShowAgent?: Props['onShowAgent'] }) {
  const [open, setOpen] = useState(false)
  const { approval, result } = item
  const pending = approval !== undefined && approval.allow === undefined
  const isAgent = isAgentTool(item.name) && item.id !== ''
  return (
    <li className={styles.tool} data-compact={compact || undefined} data-error={result?.isError || undefined} data-pending={pending || undefined} role="group" aria-label={`Tool ${item.name}`}>
      <div className={styles.toolHead}>
        <span className={styles.toolName}>{item.name}</span>
        <span className={styles.toolInput} data-path={isPathInput(item.input) || undefined} title={describeInput(item.input)}>{isAgent ? `· ${describeInput(item.input)}` : describeInput(item.input)}</span>
        {isAgent && onShowAgent && (
          <Button size="small" onClick={() => onShowAgent(item.id)}>
            Show
          </Button>
        )}
        {!result && !approval && <span className={styles.pending}>running…</span>}
        {result?.isError && <span className={styles.failed}>failed</span>}
        {approval && !pending && (
          <span className={styles.decision} data-allow={approval.allow || undefined}>
            {approval.allow ? <CheckIcon size={12} /> : <XIcon size={12} />} {approval.allow ? 'Allowed' : 'Denied'}
          </span>
        )}
      </div>
      {pending && approval && (
        <div className={styles.actions}>
          <span className={styles.note}>Waiting for your decision</span>
          <span className={styles.spacer} />
          <Button size="small" variant="primary" disabled={approvalBusy} onClick={() => onApproval(approval.approvalId, true)}>
            Allow
          </Button>
          <Button size="small" variant="danger" disabled={approvalBusy} onClick={() => onApproval(approval.approvalId, false)}>
            Deny
          </Button>
        </div>
      )}
      {(result || item.input !== undefined) && !pending && (
        <button type="button" className={styles.resultToggle} aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpen(!open)}>
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          <span className={styles.resultLine}>{result ? summarizeResult(result.summary) : 'Input'}</span>
        </button>
      )}
      {open && !pending && (
        <div className={styles.detail}>
          <pre>{pretty(item.input)}</pre>
          {result && <pre data-result>{result.summary || '(no output)'}</pre>}
        </div>
      )}
    </li>
  )
}

export function Timeline({ items, onApproval, approvalBusy, onCommand, availableCommands = [], onShowAgent }: Props) {
  const openTab = useWorkspace((s) => s.openTab)
  return (
    <ol className={styles.timeline} aria-label="Timeline">
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <li key={item.key} className={styles.user}>
                {splitCardRefs(item.text).map((part, i) => (typeof part === 'string' ? part : <CardRefChip key={i} cardId={part.cardId} />))}
              </li>
            )
          case 'text':
            return (
              <li key={item.key} className={styles.text}>
                <Markdown rehypePlugins={rehypeCode} components={markdownComponents}>{item.text}</Markdown>
              </li>
            )
          case 'tool':
            return <ToolRow key={item.key} item={item} onApproval={onApproval} approvalBusy={approvalBusy} onShowAgent={onShowAgent} />
          case 'card':
            return (
              <li key={item.key} className={styles.chipRow}>
                <button type="button" className={styles.chip} aria-label={`Card ${cardLabel(item.cardId)} ${item.action}`} onClick={() => openTab(makeTab('card', item.cardId))}>
                  {cardLabel(item.cardId)}
                </button>
                <span className={styles.note}>card {item.action}</span>
              </li>
            )
          case 'notice':
            return (
              <li key={item.key} className={styles.notice} role="note">
                <InfoIcon size={14} />
                <span className={styles.noticeText}>{item.text}</span>
                {onCommand &&
                  item.commands
                    .filter((command) => availableCommands.includes(command))
                    .map((command) => (
                      <Button key={command} size="small" onClick={() => onCommand(command)}>
                        Run /{command}
                      </Button>
                    ))}
              </li>
            )
          case 'error':
            return (
              <li key={item.key} className={styles.errorItem} role="alert">
                <AlertIcon size={14} /> {item.message}
              </li>
            )
        }
      })}
    </ol>
  )
}
