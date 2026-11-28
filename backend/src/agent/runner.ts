// The boundary between PromptSys and a coding agent: the service only knows this interface, the SDK runner and the fake implement it.
import type { LinkKind } from '../card/schema.ts'

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const
/** `default` = ask (the PromptSys gate), `acceptEdits` = edits inside the project run on their own, `plan` = read-only planning, `auto` = the SDK decides. */
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export type AgentEvent =
  /** `images` are the ids of pasted images (`code_images`). */
  | { type: 'user'; text: string; images?: number[] }
  | { type: 'init'; sdkSessionId: string; model?: string; slashCommands: string[] }
  /** `parentToolUseId` is set when a subagent (started by that Agent/Task tool call) produced the event. */
  | { type: 'text'; text: string; parentToolUseId?: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown; parentToolUseId?: string }
  /** `summary` is truncated to about 2000 characters. */
  | { type: 'tool_result'; id: string; isError: boolean; summary: string; parentToolUseId?: string }
  | { type: 'approval_request'; approvalId: string; toolName: string; input: unknown }
  /** `answers` (question → answer) for an AskUserQuestion form, `message` = the user's note (e.g. why a plan was sent back). */
  | { type: 'approval_resolved'; approvalId: string; allow: boolean; answers?: Record<string, string>; message?: string }
  /** Messages the user sent while a turn ran; they run one after another when the turn ends (emitted by the service). */
  | { type: 'queue'; items: QueuedMessage[] }
  | { type: 'card'; cardId: number; action: 'created' | 'linked' }
  | { type: 'status'; status: 'idle' | 'running' | 'waiting_approval' | 'error' | 'stopped' }
  | { type: 'result'; isError: boolean; costUsd?: number; durationMs?: number }
  | { type: 'error'; message: string }
  /** A message for the user from the user's own Claude Code hooks (e.g. a SessionStart hint), like the terminal shows it. */
  | { type: 'notice'; text: string; source: string }
  /** The permission mode of the session changed (emitted by the service). */
  | { type: 'mode'; mode: PermissionMode }
  /** How full the context window is after a turn. */
  | { type: 'context'; percentage: number; totalTokens: number; maxTokens: number }
  /** Tokens of one finished turn. */
  | { type: 'usage'; input: number; output: number; cacheRead: number; cacheCreation: number }
  /** Plan rate-limit utilization (percent) after a turn; only for subscription logins. */
  | { type: 'plan_usage'; fiveHour?: PlanWindow; sevenDay?: PlanWindow; subscriptionType: string | null }

export type QueuedMessage = { id: string; text: string; images?: number[] }

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMediaType = (typeof IMAGE_TYPES)[number]
/** A pasted image for the prompt; `data` is base64. */
export type ImageInput = { mediaType: ImageMediaType; data: string }

/**
 * The user's answer to a tool call that asked. `answers` fills an AskUserQuestion (question text → chosen label, several
 * comma-separated, or free text); `mode` is the permission mode chosen when approving a plan (ExitPlanMode).
 */
export type ApprovalAnswer = { allow: boolean; message?: string; answers?: Record<string, string>; mode?: PermissionMode }

export type PlanWindow = { utilization: number; resetsAt: string | null }

export type CardLinkTarget = { cardId: number; kind?: LinkKind; label?: string }

/** What the agent may do with the card library (the `record_card` and `link_cards` tools). */
export type CardTools = {
  /** `folder` is relative to the project's card folder (e.g. "backend/api"). */
  recordCard(args: { title: string; body: string; folder?: string; linkTo?: CardLinkTarget[] }): Promise<number>
  /** Cards matching `query` in the whole library, or the project's cards without a query; one line per card. */
  findCards(args: { query?: string }): Promise<string>
  linkCards(args: { sourceId: number; targetId: number; kind?: LinkKind; label?: string }): Promise<void>
}

export type TurnInput = {
  cwd: string
  prompt: string
  /** Images that go with the prompt (pasted by the user). */
  images?: ImageInput[]
  /** The SDK session id of an earlier turn: the turn continues that conversation. */
  resume?: string
  env: Record<string, string | undefined>
  cardTools: CardTools
  /** Asks the user. Resolves when the user answered (or the session was stopped, which denies). */
  approve(req: { toolName: string; input: unknown }): Promise<ApprovalAnswer>
  signal: AbortSignal
  /** The current permission mode; read again for every tool call, because the user may change it during the turn. */
  getPermissionMode(): PermissionMode
  /** Called when the user changes the mode while the turn runs. Returns the unsubscribe function. */
  onPermissionMode(listener: (mode: PermissionMode) => void): () => void
}

export interface AgentRunner {
  available(): Promise<{ ok: boolean; reason?: string }>
  runTurn(input: TurnInput): AsyncIterable<AgentEvent>
  /**
   * Starts Claude Code in `cwd` without sending a prompt (no usage): the available slash commands and skills, and the messages
   * the user's SessionStart hooks show (`systemMessage`). Optional: without it commands appear after the first turn.
   */
  probe?(input: { cwd: string; env: Record<string, string | undefined> }): Promise<{ commands: string[]; notices: string[] }>
}
