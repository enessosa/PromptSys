// The streaming part of the chat: calls the LLM, writes Server-Sent Events, saves the answer in short writes.
import type { Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { DatabaseSync } from 'node:sqlite'
import { estimateTokens } from '../assembly/index.ts'
import {
  resolveMarker,
  StreamingCitationParser,
  summarize,
  findMarkers,
  type ParserEvent,
} from '../citation/index.ts'
import { AppError, errorBody } from '../common/errors.ts'
import { transaction } from '../db/index.ts'
import type { LlmClient, LlmRequest } from '../llm/index.ts'
import type { ChatRepository } from './repository.ts'
import type { ContextEntry } from './schema.ts'

export const PING_INTERVAL_MS = 15_000
export const SAVE_INTERVAL_MS = 1_000

/** Running generations by assistant message id; used by the stop endpoint and to refuse parallel generations. */
export type GenerationRegistry = Map<number, { controller: AbortController; timelineId: number; conversationId: number }>

export type Generation = {
  conversationId: number
  timelineId: number
  userMessageId: number
  assistantMessageId: number
  request: LlmRequest
  /** The context state saved for the user message (all states). */
  context: ContextEntry[]
  /** The cards that really went into the prompt (`included`/`pinned`, minus those dropped for the token budget). */
  sentCardIds: number[]
  droppedCardIds: number[]
}

type Deps = { db: DatabaseSync; llm: LlmClient; repo: ChatRepository; registry: GenerationRegistry }

/**
 * Answers with an SSE stream for an assistant message that already exists with `status = 'streaming'`.
 * No database transaction is open while waiting for the LLM; the answer is saved about once a second and at the end.
 */
export function streamGeneration(
  c: Context,
  deps: Deps,
  job: Generation,
  onFinish?: (status: GenerationStatus) => void,
): Response {
  return streamSSE(c, async (stream) => {
    const status = await runGeneration(stream, deps, job)
    onFinish?.(status)
  })
}

export type GenerationStatus = 'complete' | 'stopped' | 'error'

/**
 * Generates one answer into an open SSE stream (also used by the automatic replay, which runs several in one stream).
 * Resolves with how the answer ended; never throws.
 */
export async function runGeneration(stream: SSEStreamingApi, { db, llm, repo, registry }: Deps, job: Generation): Promise<GenerationStatus> {
  const controller = new AbortController()
  registry.set(job.assistantMessageId, { controller, timelineId: job.timelineId, conversationId: job.conversationId })
  stream.onAbort(() => controller.abort())

  const send = async (event: string, data: unknown) => {
    try {
      await stream.writeSSE({ event, data: JSON.stringify(data) })
    } catch {
      controller.abort() // the client is gone
    }
  }
  const ping = setInterval(() => {
    stream.write(': ping\n\n').catch(() => controller.abort())
  }, PING_INTERVAL_MS)

  const parser = new StreamingCitationParser()
  const lookup = repo.citationLookup(job.sentCardIds)
  let content = ''
  let lastSave = Date.now()
  let usage: { stopReason: string | null; inputTokens: number | null; outputTokens: number | null } = {
    stopReason: null,
    inputTokens: null,
    outputTokens: null,
  }

  const handle = async (events: ParserEvent[]) => {
    for (const event of events) {
      if (event.type === 'text') {
        content += event.text
        await send('text_delta', { text: event.text })
      } else {
        const { cardId, start, end, marker, valid } = resolveMarker(event, lookup)
        await send('citation', { cardId, marker, start, end, valid })
      }
    }
  }

  /** Saves the final state and the citation rows (re-parse of the saved text is the source of truth). */
  const finish = (status: 'complete' | 'stopped' | 'error', errorCode: string | null) => {
    const summary = summarize(findMarkers(content).map((m) => resolveMarker(m, lookup)), job.sentCardIds)
    transaction(db, () => {
      repo.finishMessage(job.assistantMessageId, {
        content,
        status,
        stopReason: usage.stopReason,
        inputTokens: usage.inputTokens ?? (status === 'complete' ? estimateRequest(job.request) : null),
        outputTokens: usage.outputTokens ?? (content ? estimateTokens(content) : null),
        errorCode,
      })
      repo.insertCitations(job.assistantMessageId, summary.citations)
    })
    return summary
  }

  try {
    await send('message_start', {
      userMessageId: job.userMessageId,
      assistantMessageId: job.assistantMessageId,
      timelineId: job.timelineId,
      cards: job.context
        .filter((e) => job.sentCardIds.includes(e.cardId))
        .map((e) => ({ cardId: e.cardId, version: e.version, state: e.state })),
      droppedCardIds: job.droppedCardIds,
    })

    for await (const event of llm.stream(job.request, controller.signal)) {
      if (controller.signal.aborted) break
      if (event.type === 'done') {
        usage = event
        continue
      }
      await handle(parser.push(event.text))
      if (Date.now() - lastSave >= SAVE_INTERVAL_MS) {
        repo.saveProgress(job.assistantMessageId, content)
        lastSave = Date.now()
      }
    }

    if (controller.signal.aborted) {
      finish('stopped', null) // stop button or closed connection: no further event
      return 'stopped'
    }
    await handle(parser.flush())
    const summary = finish('complete', null)
    await send('message_stop', {
      stopReason: usage.stopReason,
      usage: { inputTokens: usage.inputTokens ?? estimateRequest(job.request), outputTokens: usage.outputTokens ?? estimateTokens(content) },
      usedCardIds: summary.usedCardIds,
      unusedCardIds: summary.unusedCardIds,
      invalidMarkers: summary.invalidMarkers,
    })
    return 'complete'
  } catch (err) {
    if (controller.signal.aborted) {
      finish('stopped', null)
      return 'stopped'
    }
    const requestId = crypto.randomUUID()
    let failure = errorBody('internal_error', 'Internal server error', requestId)
    if (err instanceof AppError) failure = errorBody(err.code, err.message, requestId, err.details)
    else console.error(`[${requestId}]`, err)
    await handle(parser.flush())
    finish('error', failure.error.code)
    await send('error', failure)
    return 'error'
  } finally {
    clearInterval(ping)
    registry.delete(job.assistantMessageId)
  }
}

const estimateRequest = (request: LlmRequest) =>
  estimateTokens(request.system ?? '') + request.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
