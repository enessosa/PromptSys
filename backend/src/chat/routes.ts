import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { assemblePrompt } from '../assembly/index.ts'
import { AppError } from '../common/errors.ts'
import { idSchema, parse, parseBody, parseQuery } from '../common/validation.ts'
import { transaction } from '../db/index.ts'
import type { LlmClient } from '../llm/index.ts'
import { streamGeneration, type GenerationRegistry } from './generation.ts'
import { compareTimelines, createBranch, replayRoutes } from './replay.ts'
import { createChatRepository } from './repository.ts'
import {
  contextPreviewSchema,
  createConversationSchema,
  createTimelineSchema,
  regenerateSchema,
  searchQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
  type ContextEntry,
} from './schema.ts'
import { search } from './search.ts'

/** Conversations, timelines, messages, context preview, streaming chat, regenerate, stop and search (mounted under `/api`). */
export function chatRoutes(db: DatabaseSync, llm: LlmClient | undefined): Hono {
  const repo = createChatRepository(db)
  const registry: GenerationRegistry = new Map()
  const routes = new Hono()
  const idParam = (value: string) => parse(idSchema, value)

  const requireLlm = (): LlmClient => {
    if (!llm) throw new AppError(424, 'api_key_missing', 'No ANTHROPIC_API_KEY is configured, so chat is not available.')
    return llm
  }
  const refuseIfRunning = (match: (r: { timelineId: number; conversationId: number }) => boolean) => {
    if ([...registry.values()].some(match)) throw new AppError(409, 'generation_running', 'An answer is still being generated here.')
  }

  // ---- conversations -------------------------------------------------------------------------------------------

  routes.get('/conversations', (c) => c.json(repo.listConversations()))
  routes.post('/conversations', async (c) => {
    const body = await parseBody(c, createConversationSchema)
    return c.json(transaction(db, () => repo.createConversation(body)), 201)
  })
  routes.get('/conversations/:id', (c) => c.json(repo.getConversation(idParam(c.req.param('id')))))
  routes.patch('/conversations/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    return c.json(repo.updateConversation(id, await parseBody(c, updateConversationSchema)))
  })
  routes.delete('/conversations/:id', (c) => {
    const id = idParam(c.req.param('id'))
    refuseIfRunning((r) => r.conversationId === id)
    transaction(db, () => repo.deleteConversation(id))
    return c.body(null, 204)
  })

  // ---- timelines -----------------------------------------------------------------------------------------------

  routes.get('/conversations/:id/tree', (c) => {
    const id = idParam(c.req.param('id'))
    repo.getConversation(id)
    return c.json(repo.tree(id))
  })

  routes.get('/timelines/:id/messages', (c) => c.json(repo.messagesOfTimeline(repo.getTimeline(idParam(c.req.param('id'))))))

  routes.post('/conversations/:id/timelines', async (c) => {
    const conversationId = idParam(c.req.param('id'))
    repo.getConversation(conversationId)
    const body = await parseBody(c, createTimelineSchema)
    return c.json(createBranch(db, repo, conversationId, body), 201)
  })

  routes.get('/timelines/:a/compare/:b', (c) => {
    const a = repo.getTimeline(idParam(c.req.param('a')))
    const b = repo.getTimeline(idParam(c.req.param('b')))
    if (a.conversationId !== b.conversationId) {
      throw new AppError(400, 'validation_failed', 'The timelines belong to different conversations.', [{ path: 'b', message: 'different conversation' }])
    }
    return c.json(compareTimelines(repo, a, b))
  })

  // ---- chat ----------------------------------------------------------------------------------------------------

  routes.post('/conversations/:id/context-preview', async (c) => {
    const conversationId = idParam(c.req.param('id'))
    const conversation = repo.getConversation(conversationId)
    const body = await parseBody(c, contextPreviewSchema)
    const timeline = repo.getTimeline(body.timelineId)
    if (timeline.conversationId !== conversationId) throw new AppError(404, 'timeline_not_found', `Timeline ${timeline.id} not found`)
    const context = body.cards ? repo.explicitContext(body.cards) : (repo.pendingContext(timeline.id) ?? repo.defaultContext(timeline.headMessageId))
    const prompt = assemblePrompt({
      systemPrompt: conversation.systemPrompt,
      cards: repo.promptCards(context),
      history: repo.historyOf(timeline.headMessageId),
      userContent: body.content?.trim() ? body.content.trim() : undefined,
    })
    return c.json({
      cards: repo.describeContext(context),
      estimatedInputTokens: prompt.estimatedInputTokens,
      droppedCardIds: prompt.droppedCardIds,
      prompt: { system: prompt.system, messages: prompt.messages },
    })
  })

  routes.post('/timelines/:id/messages', async (c) => {
    const timelineId = idParam(c.req.param('id'))
    const body = await parseBody(c, sendMessageSchema)
    const client = requireLlm()
    const timeline = repo.getTimeline(timelineId)
    const conversation = repo.getConversation(timeline.conversationId)
    refuseIfRunning((r) => r.timelineId === timelineId)
    if (timeline.replayStatus === 'paused' || timeline.replayStatus === 'running') {
      throw new AppError(409, 'replay_active', 'This timeline is being replayed. Branch off or cancel the replay first.')
    }

    const context = body.cards ? repo.explicitContext(body.cards) : (repo.pendingContext(timeline.id) ?? repo.defaultContext(timeline.headMessageId))
    const prompt = assemblePrompt({
      systemPrompt: conversation.systemPrompt,
      cards: repo.promptCards(context),
      history: repo.historyOf(timeline.headMessageId),
      userContent: body.content,
    })

    // Short write: the user message, its context and the (empty, streaming) answer. Then the transaction is closed.
    const { userMessageId, assistantMessageId } = transaction(db, () => {
      const userMessageId = repo.insertMessage({ conversationId: conversation.id, parentId: timeline.headMessageId, role: 'user', content: body.content })
      repo.insertContext(userMessageId, context)
      repo.clearPendingContext(timelineId)
      const assistantMessageId = repo.insertMessage({
        conversationId: conversation.id,
        parentId: userMessageId,
        role: 'assistant',
        status: 'streaming',
        model: conversation.model ?? client.model,
      })
      repo.setHead(timelineId, assistantMessageId)
      repo.touchConversation(conversation.id, body.content)
      return { userMessageId, assistantMessageId }
    })

    return streamGeneration(c, { db, llm: client, repo, registry }, {
      conversationId: conversation.id,
      timelineId,
      userMessageId,
      assistantMessageId,
      request: { system: prompt.system, messages: prompt.messages, model: conversation.model ?? undefined },
      context,
      sentCardIds: prompt.cardIds,
      droppedCardIds: prompt.droppedCardIds,
    })
  })

  routes.post('/messages/:id/regenerate', async (c) => {
    const messageId = idParam(c.req.param('id'))
    const body = await parseBody(c, regenerateSchema)
    const client = requireLlm()
    const answer = repo.getMessage(messageId)
    if (answer.role !== 'assistant' || answer.parentId === null) {
      throw new AppError(400, 'validation_failed', 'Only answers can be regenerated.', [{ path: 'id', message: 'not an assistant message' }])
    }
    if (registry.has(answer.id)) throw new AppError(409, 'generation_running', 'This answer is still being generated.')
    const question = repo.getMessage(answer.parentId)
    const conversation = repo.getConversation(answer.conversationId)

    // Same text as before: the stored card versions, with the excluded cards switched off.
    const original = repo.contextOf(question.id)
    const known = new Set(original.map((e) => e.cardId))
    const unknown = body.excludeCardIds.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      throw new AppError(400, 'validation_failed', `Card c${unknown[0]} is not part of this message's context`, [{ path: 'excludeCardIds', message: 'not in context' }])
    }
    const excluded = new Set(body.excludeCardIds)
    const changed = original.filter((e) => e.state !== 'excluded' && excluded.has(e.cardId)).map((e) => e.cardId)
    const context: ContextEntry[] = original.map((e) => (excluded.has(e.cardId) ? { ...e, state: 'excluded' } : e))

    const history = repo.historyOf(question.parentId)
    const prompt = assemblePrompt({
      systemPrompt: conversation.systemPrompt,
      cards: repo.promptCards(context),
      history,
      userContent: question.content,
    })

    const { userMessageId, assistantMessageId, timelineId } = transaction(db, () => {
      // Without changes the new answer is a sibling of the old one; with changes the question is copied with the new
      // context, because the context state belongs to the user message.
      const userMessageId =
        changed.length === 0
          ? question.id
          : repo.insertMessage({ conversationId: conversation.id, parentId: question.parentId, role: 'user', content: question.content, replayOfId: question.id })
      if (changed.length > 0) repo.insertContext(userMessageId, context)
      const assistantMessageId = repo.insertMessage({
        conversationId: conversation.id,
        parentId: userMessageId,
        role: 'assistant',
        status: 'streaming',
        model: conversation.model ?? client.model,
      })
      const summary = changed.length > 0 ? `excluded ${changed.map((id) => `c${id}`).join(', ')}` : null
      const timeline = repo.createTimeline({
        conversationId: conversation.id,
        name: summary ? `Without ${changed.map((id) => `c${id}`).join(', ')}` : `Regeneration ${repo.timelinesOf(conversation.id).length}`,
        parentTimelineId: repo.timelineContaining(conversation.id, answer.id)?.id ?? null,
        branchPointId: changed.length === 0 ? question.id : question.parentId,
        headMessageId: assistantMessageId,
        changeSummary: summary,
      })
      repo.updateConversation(conversation.id, { activeTimelineId: timeline.id })
      return { userMessageId, assistantMessageId, timelineId: timeline.id }
    })

    return streamGeneration(c, { db, llm: client, repo, registry }, {
      conversationId: conversation.id,
      timelineId,
      userMessageId,
      assistantMessageId,
      request: { system: prompt.system, messages: prompt.messages, model: conversation.model ?? undefined },
      context,
      sentCardIds: prompt.cardIds,
      droppedCardIds: prompt.droppedCardIds,
    })
  })

  routes.post('/messages/:id/stop', (c) => {
    const id = idParam(c.req.param('id'))
    repo.getMessage(id)
    registry.get(id)?.controller.abort() // not running: nothing to do (idempotent)
    return c.body(null, 204)
  })

  routes.route('/replays', replayRoutes({ db, repo, registry, requireLlm, refuseIfRunning }))

  // ---- search --------------------------------------------------------------------------------------------------

  routes.get('/search', (c) => c.json(search(db, parseQuery(c, searchQuerySchema).q)))

  return routes
}
