import { z } from 'zod'
import { idSchema } from '../common/validation.ts'

export const CARD_STATES = ['included', 'pinned', 'excluded'] as const
export type CardState = (typeof CARD_STATES)[number]

const title = z.string().trim().min(1).max(200)
const systemPrompt = z.string().max(100_000)
const model = z.string().trim().min(1).max(100)

export const createConversationSchema = z.object({
  title: title.optional(),
  systemPrompt: systemPrompt.default(''),
  model: model.nullish(),
})

export const updateConversationSchema = z
  .object({
    title,
    systemPrompt,
    model: model.nullable(),
    showDerivedRules: z.boolean(),
    activeTimelineId: idSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field to change is required')

export const cardStateSchema = z.object({ cardId: idSchema, state: z.enum(CARD_STATES) })
const cardList = z.array(cardStateSchema).max(500)

const editedCard = z
  .object({ cardId: idSchema, title: title.optional(), body: z.string().max(1_000_000).optional() })
  .refine((v) => v.title !== undefined || v.body !== undefined, 'title or body is required')

/** Changes to the context at a branch point; edits create forked cards that replace the original in that branch only. */
export const contextChangesSchema = z.object({
  cards: cardList.default([]),
  editedCards: z.array(editedCard).max(100).default([]),
})
export type ContextChanges = z.infer<typeof contextChangesSchema>

export const createTimelineSchema = z.object({
  fromMessageId: idSchema,
  name: z.string().trim().min(1).max(100).optional(),
  contextChanges: contextChangesSchema.optional(),
})

export const createReplaySchema = z.object({
  fromMessageId: idSchema,
  /** The timeline whose later prompts are replayed; default: the first timeline that contains `fromMessageId`. */
  sourceTimelineId: idSchema.optional(),
  contextChanges: contextChangesSchema.default({ cards: [], editedCards: [] }),
  mode: z.enum(['step', 'auto']).default('step'),
  dryRun: z.boolean().default(false),
  name: z.string().trim().min(1).max(100).optional(),
})

export const replayNextSchema = z
  .object({ action: z.enum(['send', 'edit', 'skip']), content: z.string().trim().min(1).max(200_000).optional() })
  .refine((v) => v.action !== 'edit' || v.content !== undefined, { message: 'content is required for edit', path: ['content'] })

export const contextPreviewSchema = z.object({
  timelineId: idSchema,
  content: z.string().max(200_000).optional(),
  cards: cardList.optional(),
})

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(200_000),
  cards: cardList.optional(),
})

export const regenerateSchema = z.object({
  excludeCardIds: z.array(idSchema).max(500).default([]),
})

export const searchQuerySchema = z.object({ q: z.string().trim().max(200).default('') })

export type Conversation = {
  id: number
  title: string
  systemPrompt: string
  model: string | null
  activeTimelineId: number | null
  showDerivedRules: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type Timeline = {
  id: number
  conversationId: number
  name: string
  parentTimelineId: number | null
  branchPointId: number | null
  headMessageId: number | null
  changeSummary: string | null
  /** `null` = ordinary timeline, otherwise the state of the replay that created it. */
  replayStatus: ReplayStatus | null
  replayMode: 'step' | 'auto' | null
  replaySourceId: number | null
  /** The next original user message to replay (`null` when none is left). */
  replayNextId: number | null
  createdAt: string
}

export type ReplayStatus = 'paused' | 'running' | 'finished' | 'branched_off' | 'cancelled'

/** A card in the context of a user message, with the exact version that was / will be sent. */
export type ContextEntry = {
  cardId: number
  version: number
  state: CardState
  position: number
}

export type ContextCard = ContextEntry & { title: string; kind: string; excerpt: string }

export type CitationDto = { cardId: number | null; marker: string; start: number; end: number; valid: boolean }

export type Message = {
  id: number
  parentId: number | null
  role: 'user' | 'assistant'
  content: string
  status: 'streaming' | 'complete' | 'stopped' | 'error'
  replayOfId: number | null
  model: string | null
  stopReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  errorCode: string | null
  createdAt: string
  /** Cards sent with this turn (user messages only, `null` for answers). */
  context: ContextCard[] | null
  /** Citations of an answer (empty for user messages). */
  citations: CitationDto[]
  usedCardIds: number[]
  unusedCardIds: number[]
  invalidMarkers: string[]
}
