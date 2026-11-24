import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { AppError, errorBody } from '../common/errors.ts'
import { idSchema, parse, parseBody } from '../common/validation.ts'
import type { LlmClient } from '../llm/index.ts'
import type { Embedder } from './embedding.ts'
import { createAblationService } from './service.ts'

const ablationSchema = z.object({
  cardIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, 'cardIds must be unique'),
  runs: z.number().int().min(1).max(10).optional(),
  baselineRuns: z.number().int().min(0).max(10).optional(),
  dryRun: z.boolean().default(false),
})

const PING_INTERVAL_MS = 15_000

/** `POST/GET /api/messages/:id/ablations` (mounted under `/api`). */
export function ablationRoutes(db: DatabaseSync, llm: LlmClient | undefined, embedder: Embedder): Hono {
  const service = createAblationService(db, llm, embedder)
  const routes = new Hono()

  routes.post('/messages/:id/ablations', async (c) => {
    const messageId = parse(idSchema, c.req.param('id'))
    const { dryRun, ...request } = await parseBody(c, ablationSchema)
    const plan = service.prepare(messageId, request)
    if (dryRun) return c.json(service.publicPlan(plan))

    return streamSSE(c, async (stream) => {
      let aborted = false
      stream.onAbort(() => {
        aborted = true
      })
      const send = async (event: string, data: unknown) => {
        try {
          await stream.writeSSE({ event, data: JSON.stringify(data) })
        } catch {
          aborted = true
        }
      }
      const ping = setInterval(() => {
        stream.write(': ping\n\n').catch(() => {
          aborted = true
        })
      }, PING_INTERVAL_MS)
      try {
        const { apiCalls } = await service.execute(plan, {
          onProgress: (event) => send('progress', event),
          onResult: (result) => send('ablation_result', result),
          isAborted: () => aborted,
        })
        if (!aborted) await send('message_stop', { messageId, apiCalls })
      } catch (err) {
        const requestId = crypto.randomUUID()
        if (err instanceof AppError) await send('error', errorBody(err.code, err.message, requestId, err.details))
        else {
          console.error(`[${requestId}]`, err)
          await send('error', errorBody('internal_error', 'Internal server error', requestId))
        }
      } finally {
        clearInterval(ping)
      }
    })
  })

  routes.get('/messages/:id/ablations', (c) => c.json(service.results(parse(idSchema, c.req.param('id')))))
  return routes
}
