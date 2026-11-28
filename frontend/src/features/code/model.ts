import type { CodeEventRecord, CodeSessionStatus, PermissionMode } from '../../api/types.ts'

/** A live or stored event: `seq` and `type` plus the payload fields side by side. */
export type CodeEvent = { seq: number; type: string; [field: string]: unknown }

/** One row per tool call; the approval (if one was asked) is part of the row. `id` is empty while only the approval is known. */
export type ToolItem = {
  kind: 'tool'
  key: string
  id: string
  name: string
  input: unknown
  result?: { isError: boolean; summary: string }
  approval?: { approvalId: string; allow?: boolean; answers?: Record<string, string>; message?: string }
}

/** The user's reply to a tool call that asked: allow/deny, answers of a question form, the mode chosen with a plan, a note. */
export type ApprovalReply = { allow: boolean; message?: string; answers?: Record<string, string>; mode?: PermissionMode }

export type QueuedMessage = { id: string; text: string; images: number[] }

export type Question = { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }

/** The questions of an AskUserQuestion input; malformed entries are dropped. */
export function parseQuestions(input: unknown): Question[] {
  const list = typeof input === 'object' && input !== null ? (input as { questions?: unknown }).questions : undefined
  if (!Array.isArray(list)) return []
  return list.flatMap((q): Question[] => {
    if (typeof q !== 'object' || q === null || typeof (q as { question?: unknown }).question !== 'string') return []
    const o = q as Record<string, unknown>
    const options = Array.isArray(o.options)
      ? o.options.flatMap((x) => (typeof x === 'object' && x !== null && typeof (x as { label?: unknown }).label === 'string' ? [{ label: (x as { label: string }).label, description: str((x as { description?: unknown }).description) }] : []))
      : []
    return [{ question: o.question as string, header: str(o.header), multiSelect: o.multiSelect === true, options }]
  })
}

/** The answer text of one question: the picked labels (comma-separated) and the free text of "Other"; '' while unanswered. */
export function answerOf(choice: { picked: string[]; other: string; otherOn: boolean }, multiSelect: boolean): string {
  const other = choice.otherOn ? choice.other.trim() : ''
  if (!multiSelect) return other || choice.picked[0] || ''
  return [...choice.picked, ...(other ? [other] : [])].join(', ')
}

/** The plan text of an ExitPlanMode input. */
export const planText = (input: unknown): string => (typeof input === 'object' && input !== null ? str((input as { plan?: unknown }).plan) : '')

/** What a subagent did: its own text and tool rows. */
export type AgentItem = { kind: 'text'; key: string; text: string } | ToolItem

/** `stopped` = the turn ended (or was interrupted) before the agent reported a result. */
export type AgentStatus = 'running' | 'done' | 'error' | 'stopped'

/** A subagent started by an Agent (older: Task) tool call of the main agent. `id` is that tool call's id. */
export type AgentEntry = { id: string; description: string; subagentType: string; prompt: string; status: AgentStatus; items: AgentItem[]; result?: string }

export const isAgentTool = (name: string) => name === 'Agent' || name === 'Task'

export type TimelineItem =
  /** `images` are ids of pasted images, served by `/api/code/sessions/:id/images/:imageId`. */
  | { kind: 'user'; key: string; text: string; images: number[] }
  | { kind: 'text'; key: string; text: string }
  | ToolItem
  | { kind: 'card'; key: string; cardId: number; action: 'created' | 'linked' }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'notice'; key: string; text: string; commands: string[] }


export type SessionState = {
  lastSeq: number
  items: TimelineItem[]
  /** Subagents of the main agent, in order of start; their events never appear in `items`. */
  agents: AgentEntry[]
  status: CodeSessionStatus
  slashCommands: string[]
  /** Result of the latest finished turn. */
  lastResult: { isError: boolean; costUsd?: number; durationMs?: number } | null
  permissionMode: PermissionMode
  model: string | null
  /** Context window usage (percent) after the latest turn. */
  context: { percentage: number; totalTokens: number; maxTokens: number } | null
  /** Tokens summed over all `usage` events of the session. */
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
  /** Number of finished turns seen; changes trigger refreshes of git info and changes. */
  turns: number
  /** Messages waiting for the running turn to end. */
  queue: QueuedMessage[]
}

export const emptyState = (status: CodeSessionStatus = 'idle', slashCommands: string[] = [], permissionMode: PermissionMode = 'default'): SessionState => ({
  lastSeq: 0,
  items: [],
  agents: [],
  status,
  slashCommands,
  lastResult: null,
  permissionMode,
  model: null,
  context: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  turns: 0,
  queue: [],
})

export const fromRecord = (r: CodeEventRecord): CodeEvent => ({ ...r.payload, seq: r.seq, type: r.type })

function newAgent(id: string, input: unknown): AgentEntry {
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return { id, description: str(o.description), subagentType: str(o.subagent_type), prompt: str(o.prompt), status: 'running', items: [] }
}

const sameInput = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [])

/** Folds an event of a subagent (it has a `parentToolUseId`) into that agent's items. Unknown agents are ignored. */
function applyAgentEvent(state: SessionState, next: SessionState, ev: CodeEvent, parent: string, key: string): SessionState {
  if (!state.agents.some((a) => a.id === parent)) return next
  const update = (fn: (items: AgentItem[]) => AgentItem[]) => ({ ...next, agents: state.agents.map((a) => (a.id === parent ? { ...a, items: fn(a.items) } : a)) })
  if (ev.type === 'text') {
    return update((items) => {
      const last = items[items.length - 1]
      return last?.kind === 'text' ? [...items.slice(0, -1), { ...last, text: last.text + str(ev.text) }] : [...items, { kind: 'text', key, text: str(ev.text) }]
    })
  }
  if (ev.type === 'tool_call') return update((items) => [...items, { kind: 'tool', key, id: str(ev.id), name: str(ev.name), input: ev.input }])
  if (ev.type === 'tool_result') {
    const result = { isError: ev.isError === true, summary: str(ev.summary) }
    return update((items) => items.map((i) => (i.kind === 'tool' && i.id === ev.id ? { ...i, result } : i)))
  }
  return next
}

/**
 * Folds one event into the timeline. Events with a `seq` that was already seen are ignored (the history
 * and the live stream overlap); consecutive text events form one streamed paragraph.
 */
export function applyEvent(state: SessionState, ev: CodeEvent): SessionState {
  if (ev.seq <= state.lastSeq) return state
  const key = `e${ev.seq}`
  const next: SessionState = { ...state, lastSeq: ev.seq }
  const parent = str(ev.parentToolUseId)
  if (parent && (ev.type === 'text' || ev.type === 'tool_call' || ev.type === 'tool_result')) return applyAgentEvent(state, next, ev, parent, key)
  switch (ev.type) {
    case 'user':
      return { ...next, items: [...state.items, { kind: 'user', key, text: str(ev.text), images: ids(ev.images) }] }
    case 'init': {
      const cmds = Array.isArray(ev.slashCommands) ? ev.slashCommands.filter((c): c is string => typeof c === 'string') : state.slashCommands
      return { ...next, slashCommands: cmds, model: typeof ev.model === 'string' ? ev.model : state.model }
    }
    case 'text': {
      const last = state.items[state.items.length - 1]
      if (last?.kind === 'text') return { ...next, items: [...state.items.slice(0, -1), { ...last, text: last.text + str(ev.text) }] }
      return { ...next, items: [...state.items, { kind: 'text', key, text: str(ev.text) }] }
    }
    case 'tool_call': {
      const id = str(ev.id)
      // A tool row that only has its approval so far (the approval came first) takes over the call.
      const at = state.items.findIndex((i) => i.kind === 'tool' && i.id === '' && i.name === str(ev.name) && sameInput(i.input, ev.input))
      const agents = isAgentTool(str(ev.name)) ? [...state.agents, newAgent(id, ev.input)] : state.agents
      if (at >= 0) return { ...next, agents, items: state.items.map((i, n) => (n === at && i.kind === 'tool' ? { ...i, id, input: ev.input } : i)) }
      return { ...next, agents, items: [...state.items, { kind: 'tool', key, id, name: str(ev.name), input: ev.input }] }
    }
    case 'tool_result': {
      const result = { isError: ev.isError === true, summary: str(ev.summary) }
      const agents = state.agents.map((a) => (a.id === ev.id ? { ...a, status: result.isError ? ('error' as const) : ('done' as const), result: result.summary } : a))
      return { ...next, agents, items: state.items.map((i) => (i.kind === 'tool' && i.id === ev.id ? { ...i, result } : i)) }
    }
    case 'approval_request': {
      const approval = { approvalId: str(ev.approvalId) }
      const name = str(ev.toolName)
      let at = -1
      state.items.forEach((i, n) => {
        if (i.kind === 'tool' && !i.approval && !i.result && i.name === name && i.id !== '' && sameInput(i.input, ev.input)) at = n
      })
      if (at < 0) {
        state.items.forEach((i, n) => {
          if (i.kind === 'tool' && !i.approval && !i.result && i.name === name && i.id !== '') at = n
        })
      }
      if (at >= 0) return { ...next, items: state.items.map((i, n) => (n === at && i.kind === 'tool' ? { ...i, approval } : i)) }
      return { ...next, items: [...state.items, { kind: 'tool', key, id: '', name, input: ev.input, approval }] }
    }
    case 'approval_resolved': {
      const answers = typeof ev.answers === 'object' && ev.answers !== null ? (ev.answers as Record<string, string>) : undefined
      const resolved = (approvalId: string) => ({ approvalId, allow: ev.allow === true, ...(answers ? { answers } : {}), ...(typeof ev.message === 'string' ? { message: ev.message } : {}) })
      return { ...next, items: state.items.map((i) => (i.kind === 'tool' && i.approval && i.approval.approvalId === ev.approvalId ? { ...i, approval: resolved(i.approval.approvalId) } : i)) }
    }
    case 'queue':
      return {
        ...next,
        queue: Array.isArray(ev.items) ? ev.items.flatMap((m) => (typeof m === 'object' && m !== null && typeof m.id === 'string' && typeof m.text === 'string' ? [{ id: m.id as string, text: m.text as string, images: ids(m.images) }] : [])) : [],
      }
    case 'card':
      return { ...next, items: [...state.items, { kind: 'card', key, cardId: Number(ev.cardId), action: ev.action === 'linked' ? 'linked' : 'created' }] }
    case 'status': {
      const status = ev.status as CodeSessionStatus
      // When the turn is over, an agent without a result will not report one any more.
      const over = status !== 'running' && status !== 'waiting_approval'
      const agents = over && state.agents.some((a) => a.status === 'running') ? state.agents.map((a) => (a.status === 'running' ? { ...a, status: 'stopped' as const } : a)) : state.agents
      return { ...next, status, agents }
    }
    case 'mode':
      return { ...next, permissionMode: PERMISSION_MODES.includes(ev.mode as PermissionMode) ? (ev.mode as PermissionMode) : state.permissionMode }
    case 'context':
      return typeof ev.percentage === 'number'
        ? { ...next, context: { percentage: ev.percentage, totalTokens: Number(ev.totalTokens) || 0, maxTokens: Number(ev.maxTokens) || 0 } }
        : next
    case 'usage': {
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      const t = state.tokens
      return { ...next, tokens: { input: t.input + n(ev.input), output: t.output + n(ev.output), cacheRead: t.cacheRead + n(ev.cacheRead), cacheCreation: t.cacheCreation + n(ev.cacheCreation) } }
    }
    case 'result':
      return {
        ...next,
        turns: state.turns + 1,
        lastResult: {
          isError: ev.isError === true,
          costUsd: typeof ev.costUsd === 'number' ? ev.costUsd : undefined,
          durationMs: typeof ev.durationMs === 'number' ? ev.durationMs : undefined,
        },
      }
    case 'error':
      return { ...next, items: [...state.items, { kind: 'error', key, message: str(ev.message) }] }
    case 'notice':
      return { ...next, items: [...state.items, { kind: 'notice', key, text: str(ev.text), commands: slashCommandsIn(str(ev.text)) }] }
    default:
      return next
  }
}

export function replay(events: CodeEvent[], base: SessionState): SessionState {
  return events.reduce(applyEvent, base)
}

/** Short one-line description of a tool input (path, command, pattern …). */
export function describeInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'description']) {
    if (typeof o[k] === 'string') return o[k] as string
  }
  return ''
}

/** Slash commands that start with the typed text; only while the draft is a single `/word`. */
/** An `@query` being typed at the end of the draft (start of the draft or after a space), for the card picker. */
export function cardMention(draft: string): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(draft)
  return m ? { start: m.index + m[1].length, query: m[2] } : null
}

/** Cards whose title (or number, "c12") matches the query; title prefixes first, at most 8. */
export function cardMatches<T extends { id: number; title: string; archivedAt: string | null }>(cards: T[], query: string): T[] {
  const q = query.toLowerCase()
  const live = cards.filter((c) => c.archivedAt === null)
  const hit = (c: T) => q === '' || c.title.toLowerCase().includes(q) || `c${c.id}` === q
  const rank = (c: T) => (c.title.toLowerCase().startsWith(q) || `c${c.id}` === q ? 0 : 1)
  return live.filter(hit).sort((a, b) => rank(a) - rank(b) || b.id - a.id).slice(0, 8)
}

/** Splits a user message into text and `[cN]` card references. */
export function splitCardRefs(text: string): Array<string | { cardId: number }> {
  return text.split(/(\[c\d+\])/).filter(Boolean).map((part) => {
    const m = /^\[c(\d+)\]$/.exec(part)
    return m ? { cardId: Number(m[1]) } : part
  })
}

/**
 * The `/command` being typed at the end of the draft: at the start or after a space, so a skill can be named inside a sentence
 * ("run /plantuml"), like in the terminal. `start` is where the slash sits.
 */
export function slashToken(draft: string): { start: number; query: string } | null {
  const m = /(^|\s)\/([^\s/]*)$/.exec(draft)
  return m ? { start: m.index + m[1].length, query: m[2] } : null
}

/** Commands that start with the typed `/word` at the end of the draft (not once it is complete). */
export function slashMatches(draft: string, commands: string[]): string[] {
  const token = slashToken(draft)
  if (!token) return []
  const q = token.query.toLowerCase()
  return commands.filter((c) => c.toLowerCase().startsWith(q) && c.toLowerCase() !== q).slice(0, 8)
}

export const STATUS_LABEL: Record<CodeSessionStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting_approval: 'Waiting for approval',
  error: 'Error',
  stopped: 'Stopped',
}

export const formatCost = (usd: number) => `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`

export const GATED_TIP = 'Only available in API mode'

export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto']

export const MODE_LABEL: Record<PermissionMode, string> = { default: 'Ask', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto' }

export const MODE_HINT: Record<PermissionMode, string> = {
  default: 'Asks before edits and commands',
  acceptEdits: 'Edits inside the project run without asking; commands still ask',
  plan: 'Read-only planning, nothing is changed',
  auto: 'The SDK decides; it asks only when it is unsure',
}

/** The mode after `current` in the cycle Ask → Accept edits → Plan → Auto (Shift+Tab, like Claude Code). */
export const nextMode = (current: PermissionMode): PermissionMode => PERMISSION_MODES[(PERMISSION_MODES.indexOf(current) + 1) % PERMISSION_MODES.length]

/** The result text as a one-line summary: first non-empty line (cut) plus the number of lines. */
export function summarizeResult(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  const first = (lines.find((l) => l.trim() !== '') ?? '').trim()
  const cut = first.length > 100 ? `${first.slice(0, 100)}…` : first
  if (!cut) return '(no output)'
  return lines.length > 1 ? `${cut} (${lines.length} lines)` : cut
}

/** Last path segment of a folder path, for the status line. */
export const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** 125400 -> "125k", 1_250_000 -> "1.3M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export const CONTEXT_SEGMENTS = 10

/** Filled segments of the context bar (0-10) and its level: green below 60 %, yellow below 85 %, red otherwise. */
export function contextBar(percentage: number): { filled: number; level: 'ok' | 'warn' | 'high' } {
  const p = Math.max(0, Math.min(100, percentage))
  return { filled: Math.round((p / 100) * CONTEXT_SEGMENTS), level: p < 60 ? 'ok' : p < 85 ? 'warn' : 'high' }
}

/** True for text that looks like a file path: starts with /, ~/ or ./, or has a slash and a file extension. */
export const isPath = (s: string) => {
  const t = s.trim()
  if (!t || /\s/.test(t)) return false
  return /^(\/|~\/|\.\.?\/)[^/]/.test(t) || (t.includes('/') && /\.[A-Za-z0-9]{1,8}$/.test(t))
}

/** Tool inputs that are paths (file_path, path); commands and patterns are not. */
export const isPathInput = (input: unknown) => typeof input === 'object' && input !== null && ['file_path', 'path'].some((k) => typeof (input as Record<string, unknown>)[k] === 'string')

/** Slash commands named in a text, e.g. "load with /fetch-save" → ['fetch-save'] (no paths like /Users/x). */
export function slashCommandsIn(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/(?:^|[\s(])\/([a-z][\w:-]*)(?=$|[\s.,;:!?)])/gi)) found.add(match[1]!)
  return [...found]
}

export const PASTE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type PastedImage = { mediaType: (typeof PASTE_IMAGE_TYPES)[number]; data: string }
/** The API takes images up to 5 MB. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_MAX_COUNT = 10

export const isPasteImageType = (type: string): type is PastedImage['mediaType'] => (PASTE_IMAGE_TYPES as readonly string[]).includes(type)

/** "data:image/png;base64,AAAA" → { mediaType, data }; null for other data URLs. */
export function imageFromDataUrl(url: string): PastedImage | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url)
  return m && isPasteImageType(m[1]) ? { mediaType: m[1], data: m[2] } : null
}

export type TimelineRow = { kind: 'item'; item: TimelineItem } | { kind: 'tools'; key: string; items: ToolItem[] }

/** Tool rows that can sit in a group: no open question, no plan, no subagent (those keep their own row). */
const groupable = (i: TimelineItem): i is ToolItem =>
  i.kind === 'tool' && !(i.approval && i.approval.allow === undefined) && i.name !== 'AskUserQuestion' && i.name !== 'ExitPlanMode' && !isAgentTool(i.name)

/** Joins two or more tool calls in a row into one collapsible group, so a burst of commands takes one line. */
export function groupTools(items: TimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  let run: ToolItem[] = []
  const flush = () => {
    if (run.length >= 2) rows.push({ kind: 'tools', key: `g-${run[0].key}`, items: run })
    else for (const item of run) rows.push({ kind: 'item', item })
    run = []
  }
  for (const item of items) {
    if (groupable(item)) run.push(item)
    else {
      flush()
      rows.push({ kind: 'item', item })
    }
  }
  flush()
  return rows
}

/** "Read 3 · Bash 2" for a tool group. */
export function toolCounts(items: ToolItem[]): string {
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.name, (counts.get(i.name) ?? 0) + 1)
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ${n}` : name)).join(' · ')
}

/** Time until a plan window resets: "2h 10m", "3d 4h", "12m"; "now" once it has passed; null without a time. */
export function resetIn(resetsAt: string | null | undefined, now: number): string | null {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt) - now
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

