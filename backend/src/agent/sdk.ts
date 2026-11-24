// The real agent: Claude Code through `@anthropic-ai/claude-agent-sdk`, using the user's local Claude Code login.
// Everything that depends on the shape of SDK messages sits in the pure functions `mapSdkMessage` and `preToolUseDecision`.
import { createSdkMcpServer, query, tool, type CanUseTool, type HookCallback, type PermissionMode as SdkPermissionMode, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { LINK_KINDS } from '../card/schema.ts'
import type { AgentEvent, AgentRunner, CardTools, PermissionMode, PlanWindow, TurnInput } from './runner.ts'

const SUMMARY_LIMIT = 2000
const MCP_SERVER = 'promptsys'

/** Tools that cannot change anything: they run without asking. The own card tools are allowed too. */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'])

/** `none` = no decision from the hook: the SDK decides (and asks through `canUseTool` when it cannot). */
export type GateDecision = 'allow' | 'ask' | 'none'

/** Tools that change files; with the mode "Accept edits" they run without asking inside the project. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** The SDK's own mode for ours. "Accept edits" is done by the gate (it knows the project folder), so the SDK stays on `default`. */
export const sdkPermissionMode = (mode: PermissionMode): SdkPermissionMode => (mode === 'plan' ? 'plan' : mode === 'auto' ? 'auto' : 'default')

/**
 * Resolves symbolic links, so a link pointing outside the project counts as outside. For a path that does not exist yet, the
 * nearest existing parent is resolved and the rest appended.
 */
function realOrResolved(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(realOrResolved(parent), basename(absolute))
  }
}

/** True if `path` (absolute or relative to `cwd`) lies inside `cwd` after resolving `..` and symbolic links. */
export function isInsideProject(path: string, cwd: string): boolean {
  const root = realOrResolved(cwd)
  const target = realOrResolved(isAbsolute(path) ? path : resolve(cwd, path))
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const

/** True if every path field of the input lies inside the project (and there is at least `requirePath` of them). */
function pathsInside(toolInput: unknown, cwd: string, requirePath: boolean): boolean {
  if (typeof toolInput !== 'object' || toolInput === null) return !requirePath
  const fields = toolInput as Record<string, unknown>
  let found = false
  for (const key of PATH_FIELDS) {
    const value = fields[key]
    if (typeof value === 'string' && value !== '') {
      found = true
      if (!isInsideProject(value, cwd)) return false
    }
  }
  return found || !requirePath
}

/**
 * PromptSys' own card tools and read-only tools run on their own (a read-only tool that points outside the project folder, e.g.
 * `~/.ssh`, does not). By mode: "Accept edits" also lets edit tools with a path inside the project run; "Auto" leaves everything
 * else to the SDK (`none`); in "Ask" and "Plan" everything else asks the user.
 */
export function preToolUseDecision(toolName: string, toolInput?: unknown, cwd?: string, mode: PermissionMode = 'default'): GateDecision {
  if (toolName.startsWith(`mcp__${MCP_SERVER}__`)) return 'allow'
  const rest: GateDecision = mode === 'auto' ? 'none' : 'ask'
  if (READ_ONLY_TOOLS.has(toolName)) return cwd === undefined || pathsInside(toolInput, cwd, false) ? 'allow' : rest
  if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName) && cwd !== undefined && pathsInside(toolInput, cwd, true)) return 'allow'
  return rest
}

/**
 * The user's own installed `claude`. The SDK's bundled copy does not see the login of the installed one (on macOS the login sits
 * in the keychain, bound to that binary), so the installed one is preferred: `PROMPTSYS_CLAUDE_PATH`, then `PATH`, then the usual
 * install folders (an app started from the Finder has a minimal `PATH`). `undefined` = not installed: PromptSys does not ship
 * Claude Code, the user installs it and signs in with it.
 */
export function findClaudeExecutable(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
): string | undefined {
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates = [
    env.PROMPTSYS_CLAUDE_PATH,
    ...(env.PATH ?? '').split(delimiter).filter((dir) => dir !== '').map((dir) => join(dir, name)),
    join(home, '.local', 'bin', name),
    join(home, '.claude', 'local', name),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
  return candidates.find((path): path is string => path !== undefined && path !== '' && exists(path))
}

export const CLAUDE_NOT_INSTALLED =
  'Claude Code is not installed. Install it (https://code.claude.com/docs/en/setup), run `claude` once to sign in, then restart PromptSys.'

function requireClaude(env: Record<string, string | undefined>): string {
  const path = findClaudeExecutable(env)
  if (!path) throw new Error(CLAUDE_NOT_INSTALLED)
  return path
}

/** The `systemMessage` of a hook's JSON output (what Claude Code shows the user), or null for plain or other output. */
export function hookSystemMessage(output: string | undefined): string | null {
  if (!output) return null
  try {
    const parsed = JSON.parse(output) as unknown
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { systemMessage?: unknown }).systemMessage === 'string') {
      const text = (parsed as { systemMessage: string }).systemMessage.trim()
      return text === '' ? null : text
    }
  } catch {
    // Plain stdout of a SessionStart hook is context for the model, not a message for the user.
  }
  return null
}

export const CARD_INSTRUCTIONS = `You work inside PromptSys, which keeps a library of small "cards" next to this coding session.
Cards are a glossary of the project's resources and concepts, not a log of your work. Record a card with the tool record_card
(MCP server "${MCP_SERVER}") only for a term, a resource or a rule about one:
- a domain term or concept (e.g. "readOnly (OpenAPI)", "Binding cards"),
- a resource: a file, folder, module, endpoint, table, tool or external system (e.g. "PROGRESS.md", "Claude-Vault", "/api/code/sessions"),
- a rule or constraint that belongs to such a term (put it on that term's card).
The title is a noun or noun phrase naming the term, never an activity or a sentence. The body says what it is and how it is to be
understood in this project, in a few sentences, including assumptions you make about it.
Never record what you did, what you ran, task progress, results of commands or that something worked
(not "Ran /fetch-save successfully", "Updated the README", "Understanding of the task").
Record a card only when you learned something lasting about a term; most turns need no card. Before recording, check whether a card
for the same term exists: search with find_cards first. Connect related terms with link_cards (kinds: ${LINK_KINDS.join(', ')}).
Put each card in a fitting folder (record_card "folder", relative to the project's card folder, lowercase, e.g. "backend/api",
"frontend", "docs", "concepts", "tools"): reuse the folders that find_cards shows before inventing new ones, and follow folder
conventions from the project's instructions (CLAUDE.md) when they name any.
The user may reference cards in a message as [cN]; their content then arrives in <promptsys-cards> under "Referenced by the user".
The user reviews the cards. Cards the user confirmed or corrected arrive at the start of a prompt inside <promptsys-cards> ... </promptsys-cards>
as "[cN] title: body"; treat them as binding and link new cards to them by their number N when they relate. Terms the user rejected are
listed there too: do not record them again.`

function truncate(text: string, limit = SUMMARY_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** Plain text of a tool_result content (a string or a list of text blocks; other blocks are named). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string }
      return b.type === 'text' && typeof b.text === 'string' ? b.text : `[${b.type ?? 'unknown'}]`
    })
    .join('\n')
}

/**
 * Turns one SDK message into zero or more events. `system/init` → init, assistant text and tool_use blocks → text/tool_call,
 * user tool_result blocks → tool_result, `result` → result. All other messages (partial streams, status, hooks, …) are dropped.
 */
export function mapSdkMessage(message: SDKMessage): AgentEvent[] {
  if (message.type === 'system') {
    if (message.subtype !== 'init') return []
    return [{ type: 'init', sdkSessionId: message.session_id, model: message.model, slashCommands: message.slash_commands }]
  }
  if (message.type === 'assistant') {
    // Sub-agent messages carry the id of the Agent/Task tool call that started them.
    const parent = message.parent_tool_use_id ? { parentToolUseId: message.parent_tool_use_id } : {}
    const events: AgentEvent[] = []
    for (const block of message.message.content) {
      if (block.type === 'text') {
        if (block.text.trim()) events.push({ type: 'text', text: block.text, ...parent })
      } else if (block.type === 'tool_use') {
        events.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input, ...parent })
      }
    }
    return events
  }
  if (message.type === 'user') {
    const parent = message.parent_tool_use_id ? { parentToolUseId: message.parent_tool_use_id } : {}
    const content = message.message.content
    if (!Array.isArray(content)) return []
    const events: AgentEvent[] = []
    for (const block of content) {
      if (block.type === 'tool_result') {
        events.push({ type: 'tool_result', id: block.tool_use_id, isError: block.is_error === true, summary: truncate(resultText(block.content)), ...parent })
      }
    }
    return events
  }
  if (message.type === 'result') {
    return [{ type: 'result', isError: message.is_error, costUsd: message.total_cost_usd, durationMs: message.duration_ms }]
  }
  return []
}

function cardServer(cardTools: CardTools) {
  const kind = z.enum(LINK_KINDS).optional()
  const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], ...(isError ? { isError: true } : {}) })
  const fail = (err: unknown) => text(err instanceof Error ? err.message : String(err), true)
  return createSdkMcpServer({
    name: MCP_SERVER,
    tools: [
      tool(
        'record_card',
        'Record a glossary card for a project term or resource (title = noun phrase, body = what it is and how it is understood here). Never for actions, progress or results. Optionally link it to existing cards (by number).',
        {
          title: z.string().min(1).max(200),
          body: z.string().max(20_000),
          folder: z.string().max(200).optional(),
          linkTo: z.array(z.object({ cardId: z.number().int().positive(), kind, label: z.string().max(200).optional() })).max(20).optional(),
        },
        async (args) => {
          try {
            const id = await cardTools.recordCard(args)
            return text(`Recorded card c${id}`)
          } catch (err) {
            return fail(err)
          }
        },
      ),
      tool(
        'find_cards',
        'Search the PromptSys card library by text (title or body); without a query, list the cards of this project with their folders. Use it before record_card to avoid duplicates and to pick a folder.',
        { query: z.string().max(200).optional() },
        async (args) => {
          try {
            return text(await cardTools.findCards(args))
          } catch (err) {
            return fail(err)
          }
        },
      ),
      tool(
        'link_cards',
        'Link two existing cards (by number).',
        { sourceId: z.number().int().positive(), targetId: z.number().int().positive(), kind, label: z.string().max(200).optional() },
        async (args) => {
          try {
            await cardTools.linkCards(args)
            return text(`Linked c${args.sourceId} and c${args.targetId}`)
          } catch (err) {
            return fail(err)
          }
        },
      ),
    ],
  })
}

export function createSdkRunner(): AgentRunner {
  return {
    async available() {
      // The SDK starts the user's own installed `claude`; it is not shipped with PromptSys.
      if (typeof query !== 'function') return { ok: false, reason: 'The Claude Agent SDK could not be loaded.' }
      return findClaudeExecutable() ? { ok: true } : { ok: false, reason: CLAUDE_NOT_INSTALLED }
    },
    async probe({ cwd, env }) {
      // Start Claude Code with an input stream that never sends a prompt: no request, no usage. SessionStart hooks run at
      // startup; their `systemMessage` is what the terminal shows the user.
      const controller = new AbortController()
      const idle: AsyncIterable<never> = {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<never>>((resolve) => controller.signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), { once: true })),
        }),
      }
      const claudePath = requireClaude(env)
      const run = query({
        prompt: idle,
        options: { cwd, env, abortController: controller, settingSources: ['user', 'project'], pathToClaudeCodeExecutable: claudePath },
      })
      const notices: string[] = []
      // Keep reading until the probe ends: leaving the loop early would close the query before the commands arrive.
      let hooksFinished: () => void = () => undefined
      const hooksDone = new Promise<void>((resolve) => (hooksFinished = resolve))
      void (async () => {
        let pending = 0
        for await (const message of run) {
          if (message.type !== 'system') continue
          if (message.subtype === 'hook_started') pending++
          if (message.subtype === 'hook_response') {
            const text = hookSystemMessage(message.output || message.stdout)
            if (text) notices.push(text)
            if (--pending <= 0) hooksFinished()
          }
        }
      })().catch(() => undefined)
      try {
        const commands = (await run.supportedCommands()).map((command) => command.name)
        // Give the startup hooks a moment; most finish within a few hundred milliseconds.
        await Promise.race([hooksDone, new Promise((resolve) => setTimeout(resolve, 1500))])
        return { commands, notices }
      } finally {
        controller.abort()
        run.close()
      }
    },
    async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
      const controller = new AbortController()
      input.signal.addEventListener('abort', () => controller.abort(), { once: true })
      const ask = async (toolName: string, toolInput: unknown) => input.approve({ toolName, input: toolInput })
      const gate: HookCallback = async (hook) => {
        if (hook.hook_event_name !== 'PreToolUse') return {}
        const decision = preToolUseDecision(hook.tool_name, hook.tool_input, input.cwd, input.getPermissionMode())
        if (decision === 'none') return {}
        if (decision === 'allow') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
        const answer = await ask(hook.tool_name, hook.tool_input)
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: answer.allow ? 'allow' : 'deny',
            ...(answer.allow ? {} : { permissionDecisionReason: answer.message ?? 'The user denied this tool call.' }),
          },
        }
      }
      // What the SDK still wants to ask itself (mode "Auto", plan approval, …) goes to the user as well.
      const canUseTool: CanUseTool = async (toolName, toolInput) => {
        const answer = await ask(toolName, toolInput)
        return answer.allow ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: answer.message ?? 'The user denied this tool call.' }
      }
      const claudePath = requireClaude(input.env)
      const run = query({
        prompt: input.prompt,
        options: {
          cwd: input.cwd,
          ...(input.resume ? { resume: input.resume } : {}),
          env: input.env,
          pathToClaudeCodeExecutable: claudePath,
          settingSources: ['user', 'project'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: CARD_INSTRUCTIONS },
          mcpServers: { [MCP_SERVER]: cardServer(input.cardTools) },
          permissionMode: sdkPermissionMode(input.getPermissionMode()),
          canUseTool,
          hooks: { PreToolUse: [{ hooks: [gate] }] },
          abortController: controller,
        },
      })
      const unsubscribe = input.onPermissionMode((mode) => void run.setPermissionMode(sdkPermissionMode(mode)).catch(() => undefined))
      // Plan usage must be asked while Claude Code still runs: after the result the query is closed. Start it at init and
      // emit it with the result (the figure is from the start of the turn).
      let plan: Promise<AgentEvent | null> | undefined
      try {
        for await (const message of run) {
          if (message.type === 'system' && message.subtype === 'init' && plan === undefined) plan = planUsage(run)
          yield* mapSdkMessage(message)
          if (message.type === 'result') {
            const usage = await contextUsage(run, message)
            if (usage) yield usage
            const tokens = usageFromResult(message)
            if (tokens) yield tokens
            const planEvent = plan ? await plan : null
            if (planEvent) yield planEvent
          }
        }
      } finally {
        unsubscribe()
        run.close()
      }
    },
  }
}

/** Context window usage after a turn: the SDK's own figure, else computed from the result's per-model usage. */
async function contextUsage(run: { getContextUsage(): Promise<{ totalTokens: number; maxTokens: number; percentage: number }> }, result: SDKMessage): Promise<AgentEvent | null> {
  try {
    const u = await Promise.race([run.getContextUsage(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))])
    if (u.maxTokens > 0) return { type: 'context', percentage: u.percentage, totalTokens: u.totalTokens, maxTokens: u.maxTokens }
  } catch {
    // fall through to the result's usage
  }
  return contextFromResult(result)
}

export function contextFromResult(result: SDKMessage): AgentEvent | null {
  if (result.type !== 'result') return null
  const usages = Object.values(result.modelUsage ?? {})
  const main = usages.sort((a, b) => b.contextWindow - a.contextWindow)[0]
  if (!main || main.contextWindow <= 0) return null
  const total = main.inputTokens + main.cacheReadInputTokens + main.cacheCreationInputTokens
  return { type: 'context', percentage: Math.min(100, (total / main.contextWindow) * 100), totalTokens: total, maxTokens: main.contextWindow }
}

/** Tokens of one turn from the result message's `usage`. */
export function usageFromResult(result: SDKMessage): AgentEvent | null {
  if (result.type !== 'result') return null
  const u = result.usage as { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined
  if (!u) return null
  return { type: 'usage', input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0 }
}

type RateWindow = { utilization: number | null; resets_at: string | null } | null | undefined
type UsageResponse = { subscription_type?: string | null; rate_limits_available?: boolean; rate_limits?: { five_hour?: RateWindow; seven_day?: RateWindow } | null }

const planWindow = (w: RateWindow): PlanWindow | undefined => (w && typeof w.utilization === 'number' ? { utilization: w.utilization, resetsAt: w.resets_at ?? null } : undefined)

/** Maps the SDK's usage response to a `plan_usage` event; null when plan limits do not apply. */
export function planUsageFromResponse(r: UsageResponse | null | undefined): AgentEvent | null {
  if (!r || r.rate_limits_available !== true || !r.rate_limits) return null
  const fiveHour = planWindow(r.rate_limits.five_hour)
  const sevenDay = planWindow(r.rate_limits.seven_day)
  if (!fiveHour && !sevenDay) return null
  return { type: 'plan_usage', ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), subscriptionType: r.subscription_type ?? null }
}

/** Experimental API: any failure, a missing method or a timeout (5 s) means "no data". */
async function planUsage(run: object): Promise<AgentEvent | null> {
  try {
    const fn = (run as { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (o: { skipBehaviors: boolean }) => Promise<UsageResponse> }).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
    if (typeof fn !== 'function') return null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const r = await Promise.race([fn.call(run, { skipBehaviors: true }), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), 5000)))])
      return planUsageFromResponse(r)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}
