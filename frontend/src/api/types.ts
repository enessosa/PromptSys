// Hand-written DTO types mirroring the backend (backend/src/card/schema.ts, Draft "API design").

export const CARD_KINDS = ['note', 'file', 'memory', 'rule', 'search'] as const
export const LINK_KINDS = ['related', 'derived_from', 'part_of', 'contradicts'] as const

export type PlanWindow = { utilization: number; resetsAt: string | null }
/** Account-wide plan limits: the newest report of any session (`GET /api/code/plan-usage`). */
export type PlanUsage = { fiveHour?: PlanWindow; sevenDay?: PlanWindow; subscriptionType?: string | null; observedAt: string }

export type CardKind = (typeof CARD_KINDS)[number]
export type LinkKind = (typeof LINK_KINDS)[number]

export type Link = {
  id: number
  sourceId: number
  targetId: number
  kind: LinkKind
  label: string | null
  createdAt: string
}

/** Set on cards recorded by the coding agent; null/absent for user cards. */
export type CardOrigin = 'agent'
export type ReviewStatus = 'proposed' | 'confirmed' | 'corrected' | 'rejected'

export type CardSummary = {
  id: number
  title: string
  excerpt: string
  kind: CardKind
  folderPath: string
  defaultIncluded: boolean
  version: number
  mergedInto: number | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  origin?: CardOrigin | null
  reviewStatus?: ReviewStatus | null
}

export type Card = Omit<CardSummary, 'excerpt'> & {
  body: string
  sourceName: string | null
  mimeType: string | null
  forkedFromId: number | null
  links: Link[]
  backlinks: Link[]
}

export type CardVersion = { version: number; title: string; body: string; createdAt: string }

export type CreateCardInput = {
  title: string
  body?: string
  kind?: CardKind
  folderPath?: string
  defaultIncluded?: boolean
}

export type UpdateCardInput = Partial<Omit<CreateCardInput, 'title'> & { title: string }> & { ifVersion?: number }

export type GraphNodeDto = {
  id: number
  title: string
  kind: CardKind
  folderPath: string
  x: number | null
  y: number | null
  degree: number
  origin?: CardOrigin | null
  reviewStatus?: ReviewStatus | null
  /** Only present once the chat feature reports the active context. */
  inContext?: boolean
}

export type GraphDto = { nodes: GraphNodeDto[]; links: Link[] }

export type GraphFilter = { folder?: string; kind?: CardKind; conversationId?: number }

export type NodePosition = { id: number; x: number; y: number }

export type MergePreview = { title: string; body: string; linkCount: number }

export type MergeRecord = {
  id: number
  targetId: number
  sourceId: number
  createdAt: string
  undoneAt: string | null
}

export type MergeResult = { target: Card; merges: MergeRecord[] }
/** Undo reverts the whole merge operation; any merge id of it works. */
export type UndoMergeResult = { target: Card; restored: Card[] }

export type Conversation = {
  id: number
  title: string
  model?: string | null
  systemPrompt?: string
  activeTimelineId?: number | null
  showDerivedRules?: boolean
  createdAt?: string
  updatedAt?: string
}

export type CardState = 'included' | 'pinned' | 'excluded'

/** One card of the context state; a request carries the complete list in prompt order. */
export type ContextItem = { cardId: number; state: CardState }

export type ContextCard = ContextItem & {
  version: number
  position: number
  title: string
  kind: CardKind
  excerpt: string
}

export type Citation = { cardId: number | null; marker: string; start: number; end: number; valid: boolean }

export type MessageStatus = 'streaming' | 'complete' | 'stopped' | 'error'

export type ChatMessage = {
  id: number
  parentId: number | null
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  replayOfId: number | null
  model: string | null
  errorCode: string | null
  createdAt: string
  /** Cards sent with this turn (user messages only). */
  context: ContextCard[] | null
  citations: Citation[]
  usedCardIds: number[]
  unusedCardIds: number[]
  invalidMarkers: string[]
}

export type Timeline = {
  id: number
  conversationId: number
  name: string
  parentTimelineId: number | null
  branchPointId: number | null
  headMessageId: number | null
  changeSummary: string | null
  createdAt: string
  replayStatus?: ReplayStatus | null
  replayMode?: ReplayMode | null
  replaySourceId?: number | null
  replayNextId?: number | null
}

export type ReplayStatus = 'paused' | 'running' | 'finished' | 'branched_off' | 'cancelled'
export type ReplayMode = 'step' | 'auto'

export type ConversationTree = {
  timelines: Timeline[]
  messages: {
    id: number
    parentId: number | null
    role: 'user' | 'assistant'
    status: MessageStatus
    excerpt: string
    timelineIds: number[]
    replayOfId?: number | null
  }[]
}

export type ContextPreview = {
  cards: ContextCard[]
  estimatedInputTokens: number
  droppedCardIds: number[]
  prompt: { system: string; messages: { role: string; content: string }[] }
}

export type MessageStart = {
  userMessageId: number
  assistantMessageId: number
  timelineId: number
  cards: ContextItem[]
  droppedCardIds: number[]
}

export type MessageStop = {
  stopReason: string | null
  usage: { inputTokens: number; outputTokens: number }
  usedCardIds: number[]
  unusedCardIds: number[]
  invalidMarkers: string[]
}

export type SearchResult = {
  cards: Pick<CardSummary, 'id' | 'title' | 'kind' | 'folderPath'>[]
  conversations: Pick<Conversation, 'id' | 'title'>[]
}

export type ErrorDetail = { path?: string; message: string }

export type ErrorEnvelope = {
  error: { code: string; message: string; details?: ErrorDetail[] | null; requestId?: string }
}

// --- Ablation (Backend.md "Ablation") ---

export type AblationLabel = 'strong' | 'weak' | 'within_noise'

export type AblationDryRun = {
  messageId: number
  cardIds: number[]
  runs: number
  baselineRuns: number
  reusedBaselineRuns: number
  estimatedApiCalls: number
}

export type AblationCardResult = {
  cardId: number
  runs: number
  change: number
  noise: number
  noiseMeasured: boolean
  effect: number
  label: AblationLabel
  explanation: string
  answers: { runIndex: number; answer: string; similarity: number }[]
}

export type AblationResults = {
  messageId: number
  baseline: { runs: number; noise: number | null; answers: unknown[] }
  cards: AblationCardResult[]
}

// --- Derived rules ---

export type RuleStatus = 'proposed' | 'confirmed' | 'corrected' | 'rejected'

export type DerivedRule = {
  id: number
  conversationId: number
  messageId: number
  text: string
  status: RuleStatus
  source: { kind: 'card' | 'prior_knowledge'; cardId: number | null; reliability: 'claimed' }
  cardId: number | null
  createdAt: string
}

export type RulesExtraction = { rules: DerivedRule[]; warning?: string }

// --- Replay and branches ---

export type ContextChanges = {
  cards: ContextItem[]
  editedCards: { cardId: number; title?: string; body?: string }[]
}

export type ReplayRequest = {
  fromMessageId: number
  contextChanges?: ContextChanges
  mode: ReplayMode
  dryRun?: boolean
  sourceTimelineId?: number
}

export type ReplayResponse = {
  timeline: Timeline | null
  pendingPrompts: { messageId: number; content: string }[]
  estimatedApiCalls: number
}

export type ComparePair = { a: ChatMessage | null; b: ChatMessage | null }

export type TimelineComparison = {
  commonBranchPointId: number | null
  a: { timeline: Timeline; messages: ChatMessage[] }
  b: { timeline: Timeline; messages: ChatMessage[] }
  pairs: ComparePair[]
}

// --- Settings ---

export type Settings = {
  defaultModel: string | null
  ablationRuns: number
  baselineRuns: number
  ablationTemperature: number
  accentColor: string | null
  /** `api` = all features; `claude_code` = coding-agent sessions (some API-call features are locked). */
  mode: AppMode
  codeAuth: CodeAuth
}

export type AppMode = 'api' | 'claude_code'
export type CodeAuth = 'local_login' | 'api_key'

// --- Agent mode ---

export type CodeSessionStatus = 'idle' | 'running' | 'waiting_approval' | 'error' | 'stopped'

/** How much the agent may do without asking. Ask = `default`; "bypass" is deliberately not offered. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto'

export type CodeSession = {
  id: number
  title: string
  projectPath: string
  status: CodeSessionStatus
  permissionMode: PermissionMode
  createdAt: string
  updatedAt: string
}

export type CodeStatus = { available: boolean; reason?: string; mode: AppMode; codeAuth: CodeAuth }

/** One persisted event as `GET /code/sessions/:id` returns it. */
export type CodeEventRecord = { seq: number; type: string; payload: Record<string, unknown>; createdAt: string }

export type CodeSessionDetail = { session: CodeSession; slashCommands: string[]; events: CodeEventRecord[] }

export type SessionCard = { id: number; title: string; body: string; reviewStatus: ReviewStatus; version: number }

export type GitInfo = { isGitRepo: boolean; branch?: string; dirty?: boolean }

export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
export type FileChange = { path: string; oldPath?: string; status: ChangeStatus; added: number; removed: number; diff: string; truncated: boolean }
export type SessionChanges = { isGitRepo: boolean; files: FileChange[] }
