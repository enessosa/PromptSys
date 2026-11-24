import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { idSchema, parse, parseBody } from '../common/validation.ts'
import { createSettingsRepository, requireMode } from '../settings/index.ts'
import type { AgentRunner } from './runner.ts'
import { PERMISSION_MODES } from './runner.ts'
import { createAgentService, type AgentService } from './service.ts'

const PING_INTERVAL_MS = 15_000

const createSessionSchema = z.object({ projectPath: z.string().trim().min(1).max(1000), title: z.string().trim().min(1).max(200).optional() })
const updateSchema = z
  .object({ title: z.string().trim().min(1).max(200), permissionMode: z.enum(PERMISSION_MODES) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')
const messageSchema = z.object({ text: z.string().trim().min(1).max(100_000) })
const approvalSchema = z.object({ allow: z.boolean(), message: z.string().max(1000).optional() })
const reviewSchema = z
  .object({
    reviewStatus: z.enum(['confirmed', 'rejected']),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(200_000),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')

/** Claude Code sessions (mounted under `/api`). All routes except `/code/status` need the setting `mode = claude_code`. */
export function agentRoutes(db: DatabaseSync, runner: AgentRunner, service: AgentService = createAgentService(db, runner)): Hono {
  const settings = createSettingsRepository(db)
  const routes = new Hono()
  const idParam = (c: { req: { param(name: string): string } }, name = 'id') => parse(idSchema, c.req.param(name))

  routes.get('/code/status', async (c) => {
    const { mode, codeAuth } = settings.get()
    const { ok, reason } = await service.status()
    return c.json({ available: ok, ...(reason ? { reason } : {}), mode, codeAuth })
  })

  routes.use('/code/*', async (_c, next) => {
    requireMode(db, 'claude_code') // `/code/status` is registered above and answers first
    await next()
  })

  routes.get('/code/plan-usage', (c) => c.json(service.planUsage()))
  routes.get('/code/sessions', (c) => c.json(service.list()))
  routes.post('/code/sessions', async (c) => c.json(await service.create(await parseBody(c, createSessionSchema)), 201))
  routes.get('/code/sessions/:id', async (c) => c.json(await service.get(idParam(c))))
  routes.patch('/code/sessions/:id', async (c) => {
    const id = idParam(c)
    const { title, permissionMode } = await parseBody(c, updateSchema)
    if (title !== undefined) service.rename(id, title)
    if (permissionMode !== undefined) service.setPermissionMode(id, permissionMode)
    return c.json((await service.get(id)).session)
  })
  routes.get('/code/sessions/:id/git', async (c) => c.json(await service.git(idParam(c))))
  routes.get('/code/sessions/:id/changes', async (c) => c.json(await service.changes(idParam(c))))
  routes.delete('/code/sessions/:id', async (c) => {
    await service.remove(idParam(c))
    return c.body(null, 204)
  })

  routes.post('/code/sessions/:id/messages', async (c) => {
    const id = idParam(c)
    service.sendMessage(id, (await parseBody(c, messageSchema)).text)
    return c.json({ accepted: true }, 202)
  })

  routes.get('/code/sessions/:id/stream', (c) => {
    const id = idParam(c)
    return streamSSE(c, async (stream) => {
      // Events are queued so that the writes keep their order.
      let chain = Promise.resolve()
      const unsubscribe = service.subscribe(id, (event) => {
        chain = chain.then(() => stream.writeSSE({ event: event.type, data: JSON.stringify({ seq: event.seq, ...event.payload }) })).catch(() => undefined)
      })
      const ping = setInterval(() => void stream.write(': ping\n\n').catch(() => undefined), PING_INTERVAL_MS)
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
      })
      clearInterval(ping)
      unsubscribe()
    })
  })

  routes.post('/code/sessions/:id/approvals/:approvalId', async (c) => {
    service.resolveApproval(idParam(c), c.req.param('approvalId'), await parseBody(c, approvalSchema))
    return c.body(null, 204)
  })
  routes.post('/code/sessions/:id/stop', async (c) => {
    await service.stop(idParam(c))
    return c.body(null, 204)
  })
  routes.get('/code/sessions/:id/cards', (c) => c.json(service.sessionCards(idParam(c))))
  routes.patch('/code/cards/:id', async (c) => c.json(service.reviewCard(idParam(c), await parseBody(c, reviewSchema))))
  return routes
}
