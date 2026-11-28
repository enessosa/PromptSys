import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@primer/react'
import Markdown, { type Components } from 'react-markdown'
import { AlertIcon, CheckIcon, InfoIcon, ChevronDownIcon, ChevronRightIcon, XIcon } from '@primer/octicons-react'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { cardLabel } from '../cards/model.ts'
import { CardRefChip } from '../chat/CitationChip.tsx'
import { describeInput, groupTools, isAgentTool, parseQuestions, toolCounts, planText, splitCardRefs, isPath, isPathInput, summarizeResult, type ApprovalReply, type TimelineItem, type ToolItem } from './model.ts'
import { PlanApproval, QuestionForm } from './Questions.tsx'
import { codeComponents, rehypeCode, remarkMarkdown } from '../../components/codeMarkdown.ts'
import prose from '../../components/prose.module.css'
import { remarkCitations } from '../chat/citations.ts'
import styles from './code.module.css'

type Props = {
  items: TimelineItem[]
  onApproval: (approvalId: string, reply: ApprovalReply) => void
  approvalBusy: boolean
  /** Runs a slash command offered in a notice; only commands that exist in this session are offered. */
  onCommand?: (command: string) => void
  availableCommands?: string[]
  /** Opens the Agents tab with this agent expanded. */
  onShowAgent?: (id: string) => void
  /** URL of a pasted image of the session. */
  imageSrc?: (imageId: number) => string
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

const remarkPlugins = [...remarkMarkdown, remarkCitations]
// `[cN]` in agent text becomes a card chip (the same plugin as in chat answers, without the citation check).
const markdownComponents = {
  ...codeComponents,
  code: InlineCode,
  'cite-marker': ({ marker }: { marker?: string }) => {
    const id = Number(/^\[c(\d+)\]$/.exec(marker ?? '')?.[1])
    return Number.isInteger(id) && id > 0 ? <CardRefChip cardId={id} /> : <>{marker}</>
  },
} as unknown as Components

/** One row per tool call: name and input, the approval (buttons while pending, then a badge) and the result, collapsed to one line. */
export function ToolRow({ item, onApproval, approvalBusy, compact = false, onShowAgent }: { item: ToolItem; onApproval: Props['onApproval']; approvalBusy: boolean; compact?: boolean; onShowAgent?: Props['onShowAgent'] }) {
  const [open, setOpen] = useState(false)
  const { approval, result } = item
  const pending = approval !== undefined && approval.allow === undefined
  const isAgent = isAgentTool(item.name) && item.id !== ''
  const reply = (r: ApprovalReply) => approval && onApproval(approval.approvalId, r)
  // Questions and plans are not a yes/no for an action: they get their own form and their own words.
  const kind = item.name === 'AskUserQuestion' ? 'question' : item.name === 'ExitPlanMode' ? 'plan' : 'tool'
  const decision = !approval || pending ? '' : kind === 'question' ? (approval.allow ? 'Answered' : 'Skipped') : kind === 'plan' ? (approval.allow ? 'Plan approved' : 'Sent back') : approval.allow ? 'Allowed' : 'Denied'
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
            {approval.allow ? <CheckIcon size={12} /> : <XIcon size={12} />} {decision}
          </span>
        )}
      </div>
      {pending && kind === 'question' && <QuestionForm input={item.input} busy={approvalBusy} onAnswer={reply} />}
      {pending && kind === 'plan' && <PlanApproval input={item.input} busy={approvalBusy} onAnswer={reply} />}
      {!pending && approval?.answers && (
        <dl className={styles.answers}>
          {parseQuestions(item.input).map((q) => (
            <div key={q.question}>
              <dt>{q.header || q.question}</dt>
              <dd>{approval.answers?.[q.question] ?? '–'}</dd>
            </div>
          ))}
        </dl>
      )}
      {!pending && approval?.message && <p className={styles.note}>Note: {approval.message}</p>}
      {pending && approval && kind === 'tool' && (
        <div className={styles.actions}>
          <span className={styles.note}>Waiting for your decision</span>
          <span className={styles.spacer} />
          <Button size="small" variant="primary" disabled={approvalBusy} onClick={() => reply({ allow: true })}>
            Allow
          </Button>
          <Button size="small" variant="danger" disabled={approvalBusy} onClick={() => reply({ allow: false })}>
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
          {kind === 'plan' && planText(item.input) ? (
            <div className={prose.prose}>
              <Markdown remarkPlugins={remarkMarkdown} rehypePlugins={rehypeCode} components={codeComponents}>{planText(item.input)}</Markdown>
            </div>
          ) : (
            <pre>{pretty(item.input)}</pre>
          )}
          {result && <pre data-result>{result.summary || '(no output)'}</pre>}
        </div>
      )}
    </li>
  )
}

/** A burst of tool calls as one line ("5 tool calls · Read 3 · Bash 2"), expandable to the single rows. */
function ToolGroup({ items, onApproval, approvalBusy }: { items: ToolItem[]; onApproval: Props['onApproval']; approvalBusy: boolean }) {
  const [open, setOpen] = useState(false)
  const running = items.some((i) => !i.result)
  const failed = items.filter((i) => i.result?.isError).length
  return (
    <li className={styles.tool} role="group" aria-label={`${items.length} tool calls`}>
      <button type="button" className={styles.groupHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className={styles.toolName}>{items.length} tool calls</span>
        <span className={styles.toolInput}>{toolCounts(items)}</span>
        {running && <span className={styles.pending}>running…</span>}
        {failed > 0 && <span className={styles.failed}>{failed} failed</span>}
      </button>
      {open && (
        <ol className={styles.groupItems}>
          {items.map((item) => (
            <ToolRow key={item.key} item={item} compact onApproval={onApproval} approvalBusy={approvalBusy} />
          ))}
        </ol>
      )}
    </li>
  )
}

type RowProps = { item: TimelineItem; handlers: Handlers; approvalBusy: boolean; availableCommands: string[] }
type Handlers = Pick<Props, 'onApproval' | 'onCommand' | 'onShowAgent' | 'imageSrc'>

/** One timeline entry. Memoised: typing in the input field or a new event must not render (and parse) every earlier entry again. */
const TimelineEntry = memo(function TimelineEntry({ item, handlers, approvalBusy, availableCommands }: RowProps) {
  const openTab = useWorkspace((s) => s.openTab)
  const { onApproval, onCommand, onShowAgent, imageSrc } = handlers
  switch (item.kind) {
    case 'user':
      return (
        <li className={styles.user}>
          {imageSrc && item.images.length > 0 && (
            <span className={styles.userImages}>
              {item.images.map((id) => (
                <img key={id} src={imageSrc(id)} alt={`Pasted image ${id}`} loading="lazy" />
              ))}
            </span>
          )}
          {splitCardRefs(item.text).map((part, i) => (typeof part === 'string' ? part : <CardRefChip key={i} cardId={part.cardId} />))}
        </li>
      )
    case 'text':
      return (
        <li className={`${styles.text} ${prose.prose}`}>
          <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypeCode} components={markdownComponents}>{item.text}</Markdown>
        </li>
      )
    case 'tool':
      return <ToolRow item={item} onApproval={onApproval} approvalBusy={approvalBusy} onShowAgent={onShowAgent} />
    case 'card':
      return (
        <li className={styles.chipRow}>
          <button type="button" className={styles.chip} aria-label={`Card ${cardLabel(item.cardId)} ${item.action}`} onClick={() => openTab(makeTab('card', item.cardId))}>
            {cardLabel(item.cardId)}
          </button>
          <span className={styles.note}>card {item.action}</span>
        </li>
      )
    case 'notice':
      return (
        <li className={styles.notice} role="note">
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
        <li className={styles.errorItem} role="alert">
          <AlertIcon size={14} /> {item.message}
        </li>
      )
  }
})

const MemoGroup = memo(ToolGroup)

export function Timeline({ items, onApproval, approvalBusy, onCommand, availableCommands = [], onShowAgent, imageSrc }: Props) {
  // The callbacks change on every render of the session view; the rows get stable ones that call the latest.
  const latest = useRef<Handlers>({ onApproval, onCommand, onShowAgent, imageSrc })
  useLayoutEffect(() => {
    latest.current = { onApproval, onCommand, onShowAgent, imageSrc }
  })
  const handlers = useMemo<Handlers>(
    () => ({
      onApproval: (id, reply) => latest.current.onApproval(id, reply),
      onCommand: (command) => latest.current.onCommand?.(command),
      onShowAgent: (id) => latest.current.onShowAgent?.(id),
      imageSrc: (id) => latest.current.imageSrc?.(id) ?? '',
    }),
    [],
  )
  const rows = useMemo(() => groupTools(items), [items])
  return (
    <ol className={styles.timeline} aria-label="Timeline">
      {rows.map((row) =>
        row.kind === 'tools' ? (
          <MemoGroup key={row.key} items={row.items} onApproval={handlers.onApproval} approvalBusy={approvalBusy} />
        ) : (
          <TimelineEntry key={row.item.key} item={row.item} handlers={handlers} approvalBusy={approvalBusy} availableCommands={availableCommands} />
        ),
      )}
    </ol>
  )
}
