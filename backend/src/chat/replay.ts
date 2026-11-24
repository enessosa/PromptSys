// Branches with changed context, replays of the following prompts, and the side-by-side comparison of two timelines.
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DatabaseSync } from 'node:sqlite'
import { assemblePrompt } from '../assembly/index.ts'
import { AppError, errorBody } from '../common/errors.ts'
import { idSchema, parse, parseBody } from '../common/validation.ts'
import { transaction } from '../db/index.ts'
import { requireMode } from '../settings/index.ts'
import type { LlmClient } from '../llm/index.ts'
import { applyContextChanges } from './context-changes.ts'
import { runGeneration, streamGeneration, type Generation, type GenerationRegistry } from './generation.ts'
import type { ChatRepository, MessageRow } from './repository.ts'
import {
  createReplaySchema,
  replayNextSchema,
  type ContextChanges,
  type ContextEntry,
  type Message,
  type Timeline,
} from './schema.ts'

export type ReplayDeps = {
  db: DatabaseSync
  repo: ChatRepository
  registry: GenerationRegistry
  requireLlm: () => LlmClient
  refuseIfRunning: (match: (r: { timelineId: number; conversationId: number }) => boolean) => void
}

const notActive = (message: string) => new AppError(409, 'replay_not_active', message)

// ---- branches ------------------------------------------------------------------------------------------------

/** The context a branch starts from: the one of the user message itself, or of the question an answer belongs to. */
function baseContextAt(repo: ChatRepository, message: MessageRow): ContextEntry[] {
  if (message.role === 'user') return repo.contextOf(message.id)
  return message.parentId === null ? [] : repo.contextOf(message.parentId)
}

/**
 * A branch point is a message; the branch continues after it. Branching from a user message means "ask this again
 * differently", so the branch point is its parent (`null` for the first message of the conversation).
 */
const branchPointOf = (message: MessageRow): number | null => (message.role === 'user' ? message.parentId : message.id)

/** Creates a timeline branching from `fromMessageId`; with `contextChanges` (or from a user message) the branch starts with its own context. */
export function createBranch(
  db: DatabaseSync,
  repo: ChatRepository,
  conversationId: number,
  input: { fromMessageId: number; name?: string; contextChanges?: ContextChanges },
): Timeline {
  const from = repo.getMessage(input.fromMessageId)
  if (from.conversationId !== conversationId) throw new AppError(404, 'message_not_found', `Message ${from.id} not found`)
  return transaction(db, () => {
    const point = branchPointOf(from)
    const base = baseContextAt(repo, from)
    const changed = input.contextChanges ? applyContextChanges(db, repo, base, input.contextChanges, true) : { context: base, summary: null }
    const timeline = repo.createTimeline({
      conversationId,
      name: input.name ?? `Branch ${repo.timelinesOf(conversationId).length + 1}`,
      parentTimelineId: repo.timelineContaining(conversationId, from.id)?.id ?? null,
      branchPointId: point,
      headMessageId: point,
      changeSummary: changed.summary,
    })
    if (input.contextChanges || from.role === 'user') repo.setPendingContext(timeline.id, changed.context)
    return timeline
  })
}

// ---- replay --------------------------------------------------------------------------------------------------

type Prompt = { messageId: number; content: string }

/** The user messages of the source timeline that are still to be replayed (from `nextId` on). */
function remainingPrompts(repo: ChatRepository, timeline: Timeline): Prompt[] {
  if (timeline.replaySourceId === null || timeline.replayNextId === null) return []
  const source = repo.getTimeline(timeline.replaySourceId)
  const users = repo.pathTo(source.headMessageId).filter((m) => m.role === 'user')
  const index = users.findIndex((m) => m.id === timeline.replayNextId)
  return index < 0 ? [] : users.slice(index).map((m) => ({ messageId: m.id, content: m.content }))
}

/** A replay timeline in a state that accepts the action; a `running` one without a live stream (server restart) counts as paused. */
function requirePausedReplay(repo: ChatRepository, id: number, autoRuns: Set<number>): Timeline {
  const timeline = repo.getTimeline(id)
  if (timeline.replayStatus === null) throw notActive(`Timeline ${id} is not a replay`)
  const idle = timeline.replayStatus === 'paused' || (timeline.replayStatus === 'running' && !autoRuns.has(id))
  if (!idle) throw notActive(`The replay is ${timeline.replayStatus}`)
  return timeline
}

export function replayRoutes({ db, repo, registry, requireLlm, refuseIfRunning }: ReplayDeps): Hono {
  const routes = new Hono()
  const autoRuns = new Set<number>()
  const idParam = (value: string) => parse(idSchema, value)

  routes.post('/', async (c) => {
    const body = await parseBody(c, createReplaySchema)
    if (body.mode === 'auto') requireMode(db, 'api')
    const from = repo.getMessage(body.fromMessageId)
    const conversation = repo.getConversation(from.conversationId)

    const sourceCandidates = body.sourceTimelineId === undefined ? undefined : repo.getTimeline(body.sourceTimelineId)
    if (sourceCandidates && sourceCandidates.conversationId !== conversation.id) {
      throw new AppError(404, 'timeline_not_found', `Timeline ${sourceCandidates.id} not found`)
    }
    const source = sourceCandidates ?? repo.timelineContaining(conversation.id, from.id)
    const path = repo.pathTo(source?.headMessageId ?? null)
    const index = path.findIndex((m) => m.id === from.id)
    if (!source || index < 0) {
      throw new AppError(400, 'validation_failed', `Message ${from.id} is not part of that timeline`, [{ path: 'fromMessageId', message: 'not in the source timeline' }])
    }
    const pendingPrompts: Prompt[] = path
      .slice(from.role === 'user' ? index : index + 1)
      .filter((m) => m.role === 'user')
      .map((m) => ({ messageId: m.id, content: m.content }))
    const estimatedApiCalls = pendingPrompts.length * (conversation.showDerivedRules ? 2 : 1)

    if (body.dryRun) {
      applyContextChanges(db, repo, baseContextAt(repo, from), body.contextChanges, false) // validation only
      return c.json({ timeline: null, pendingPrompts, estimatedApiCalls })
    }
    if (pendingPrompts.length === 0) {
      throw new AppError(400, 'validation_failed', 'There are no prompts after this message to replay.', [{ path: 'fromMessageId', message: 'nothing to replay' }])
    }

    const timeline = transaction(db, () => {
      const changed = applyContextChanges(db, repo, baseContextAt(repo, from), body.contextChanges, true)
      const point = branchPointOf(from)
      const created = repo.createTimeline({
        conversationId: conversation.id,
        name: body.name ?? `Replay ${repo.timelinesOf(conversation.id).length + 1}`,
        parentTimelineId: source.id,
        branchPointId: point,
        headMessageId: point,
        changeSummary: changed.summary,
        replay: { status: 'paused', mode: body.mode, sourceId: source.id, nextId: pendingPrompts[0].messageId },
      })
      repo.setPendingContext(created.id, changed.context)
      return created
    })
    return c.json({ timeline, pendingPrompts, estimatedApiCalls }, 201)
  })

  /** Creates the replayed question and the empty answer, advances the replay and builds the generation job. */
  function startTurn(timeline: Timeline, original: MessageRow, content: string, client: LlmClient): Generation {
    const conversation = repo.getConversation(timeline.conversationId)
    const context = repo.pendingContext(timeline.id) ?? repo.defaultContext(timeline.headMessageId)
    const prompt = assemblePrompt({
      systemPrompt: conversation.systemPrompt,
      cards: repo.promptCards(context),
      history: repo.historyOf(timeline.headMessageId),
      userContent: content,
    })
    const sourceUsers = repo.pathTo(repo.getTimeline(timeline.replaySourceId as number).headMessageId).filter((m) => m.role === 'user')
    const following = sourceUsers[sourceUsers.findIndex((m) => m.id === original.id) + 1]
    const originalAnswer = repo.childAnswerOf(original.id, timeline.replaySourceId as number)

    const { userMessageId, assistantMessageId } = transaction(db, () => {
      const userMessageId = repo.insertMessage({ conversationId: conversation.id, parentId: timeline.headMessageId, role: 'user', content, replayOfId: original.id })
      repo.insertContext(userMessageId, context)
      repo.clearPendingContext(timeline.id)
      const assistantMessageId = repo.insertMessage({
        conversationId: conversation.id,
        parentId: userMessageId,
        role: 'assistant',
        status: 'streaming',
        replayOfId: originalAnswer,
        model: conversation.model ?? client.model,
      })
      repo.setHead(timeline.id, assistantMessageId)
      repo.updateReplay(timeline.id, { nextId: following?.id ?? null })
      repo.touchConversation(conversation.id)
      return { userMessageId, assistantMessageId }
    })
    return {
      conversationId: conversation.id,
      timelineId: timeline.id,
      userMessageId,
      assistantMessageId,
      request: { system: prompt.system, messages: prompt.messages, model: conversation.model ?? undefined },
      context,
      sentCardIds: prompt.cardIds,
      droppedCardIds: prompt.droppedCardIds,
    }
  }

  routes.post('/:timelineId/next', async (c) => {
    const id = idParam(c.req.param('timelineId'))
    const body = await parseBody(c, replayNextSchema)
    const timeline = requirePausedReplay(repo, id, autoRuns)
    if (timeline.replayNextId === null) throw notActive('The replay has no prompts left')
    const original = repo.getMessage(timeline.replayNextId)

    if (body.action === 'skip') {
      const updated = transaction(db, () => {
        const sourceUsers = repo.pathTo(repo.getTimeline(timeline.replaySourceId as number).headMessageId).filter((m) => m.role === 'user')
        const following = sourceUsers[sourceUsers.findIndex((m) => m.id === original.id) + 1]
        repo.updateReplay(id, { status: following ? 'paused' : 'finished', nextId: following?.id ?? null })
        return repo.getTimeline(id)
      })
      return c.json({ timeline: updated })
    }

    const client = requireLlm()
    refuseIfRunning((r) => r.timelineId === id)
    const job = startTurn(timeline, original, body.action === 'edit' ? (body.content as string) : original.content, client)
    return streamGeneration(c, { db, llm: client, repo, registry }, job, () => {
      const now = repo.getTimeline(id)
      if (now.replayStatus === 'paused' && now.replayNextId === null) repo.updateReplay(id, { status: 'finished' })
    })
  })

  routes.post('/:timelineId/auto', (c) => {
    requireMode(db, 'api')
    const id = idParam(c.req.param('timelineId'))
    const timeline = requirePausedReplay(repo, id, autoRuns)
    const prompts = remainingPrompts(repo, timeline)
    if (prompts.length === 0) throw notActive('The replay has no prompts left')
    const client = requireLlm()
    refuseIfRunning((r) => r.timelineId === id)
    repo.updateReplay(id, { status: 'running', mode: 'auto' })
    autoRuns.add(id)

    return streamSSE(c, async (stream) => {
      const total = prompts.length
      let done = 0
      let ending: 'finished' | 'cancelled' | 'paused' = 'finished'
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined)
      try {
        await send('progress', { done, total })
        for (const prompt of prompts) {
          if (stream.aborted || stream.closed || repo.getTimeline(id).replayStatus !== 'running') {
            ending = 'cancelled'
            break
          }
          const job = startTurn(repo.getTimeline(id), repo.getMessage(prompt.messageId), prompt.content, client)
          const outcome = await runGeneration(stream, { db, llm: client, repo, registry }, job)
          if (outcome === 'stopped') {
            ending = 'cancelled'
            break
          }
          if (outcome === 'error') {
            ending = 'paused' // the error event was sent; the rest can be continued step by step
            break
          }
          done++
          await send('progress', { done, total })
        }
      } catch (err) {
        ending = 'paused'
        const requestId = crypto.randomUUID()
        if (!(err instanceof AppError)) console.error(`[${requestId}]`, err)
        await send('error', err instanceof AppError ? errorBody(err.code, err.message, requestId, err.details) : errorBody('internal_error', 'Internal server error', requestId))
      } finally {
        autoRuns.delete(id)
        const current = repo.getTimeline(id)
        // A cancel or branch-off from outside has already set the final status.
        if (current.replayStatus === 'running') repo.updateReplay(id, { status: ending })
      }
      const final = repo.getTimeline(id)
      await send('replay_finished', { timelineId: id, status: final.replayStatus, done, total })
    })
  })

  routes.post('/:timelineId/branch-off', (c) => {
    const id = idParam(c.req.param('timelineId'))
    requirePausedReplay(repo, id, autoRuns)
    repo.updateReplay(id, { status: 'branched_off', nextId: null })
    return c.json(repo.getTimeline(id))
  })

  routes.post('/:timelineId/cancel', (c) => {
    const id = idParam(c.req.param('timelineId'))
    const timeline = repo.getTimeline(id)
    if (timeline.replayStatus !== 'paused' && timeline.replayStatus !== 'running') throw notActive(`The replay is ${timeline.replayStatus ?? 'not a replay'}`)
    repo.updateReplay(id, { status: 'cancelled' })
    for (const run of registry.values()) if (run.timelineId === id) run.controller.abort()
    return c.json(repo.getTimeline(id))
  })

  return routes
}

// ---- comparing two timelines ---------------------------------------------------------------------------------

/** Both timelines from their common branch point on; messages are paired by what they replay (`replayOfId`). */
export function compareTimelines(repo: ChatRepository, a: Timeline, b: Timeline) {
  const pathA = repo.pathTo(a.headMessageId)
  const pathB = repo.pathTo(b.headMessageId)
  let shared = 0
  while (shared < pathA.length && shared < pathB.length && pathA[shared].id === pathB[shared].id) shared++

  const messagesOf = (timeline: Timeline) => repo.messagesOfTimeline(timeline).slice(shared)
  const tailA = messagesOf(a)
  const tailB = messagesOf(b)

  // A message and the message that replays it share a key; so do two messages that replay the same original.
  const key = (m: Message) => m.replayOfId ?? m.id
  const indexB = new Map(tailB.map((m, i) => [key(m), i]))
  const rows: { a: Message | null; b: Message | null }[] = []
  let next = 0
  for (const m of tailA) {
    const at = indexB.get(key(m))
    if (at !== undefined && at >= next && tailB[at].role === m.role) {
      for (; next < at; next++) rows.push({ a: null, b: tailB[next] })
      rows.push({ a: m, b: tailB[at] })
      next = at + 1
    } else {
      rows.push({ a: m, b: null })
    }
  }
  for (; next < tailB.length; next++) rows.push({ a: null, b: tailB[next] })

  return {
    commonBranchPointId: shared > 0 ? pathA[shared - 1].id : null,
    a: { timeline: a, messages: tailA },
    b: { timeline: b, messages: tailB },
    pairs: rows,
  }
}
