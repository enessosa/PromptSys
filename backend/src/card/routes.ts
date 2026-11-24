import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { idSchema, parse, parseBody, parseQuery } from '../common/validation.ts'
import { AppError } from '../common/errors.ts'
import { createMergeRepository } from './merge.ts'
import { createCardRepository } from './repository.ts'
import { MAX_UPLOAD_BYTES, readTextUpload } from './upload.ts'
import {
  createCardSchema,
  createMergeSchema,
  folderPath,
  createLinkSchema,
  graphQuerySchema,
  listCardsQuerySchema,
  positionsSchema,
  previewMergeSchema,
  updateCardSchema,
  updateLinkSchema,
} from './schema.ts'

/** REST endpoints for cards, links and the graph (mounted under `/api`). */
export function cardRoutes(db: DatabaseSync): Hono {
  const repo = createCardRepository(db)
  const merges = createMergeRepository(db)
  const routes = new Hono()
  const idParam = (value: string) => parse(idSchema, value)

  routes.get('/cards', (c) => {
    const { query, kind, folder, includeArchived } = parseQuery(c, listCardsQuerySchema)
    return c.json(repo.list({ query, kind, folder, includeArchived: includeArchived === 'true' }))
  })
  routes.post('/cards', async (c) => c.json(repo.create(await parseBody(c, createCardSchema)), 201))
  routes.post('/cards/upload', async (c) => {
    // Reject obviously oversized requests before reading them (the multipart envelope adds a little to the file size).
    if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new AppError(413, 'file_too_large', 'The upload is larger than 10 MB', { maxBytes: MAX_UPLOAD_BYTES })
    }
    let form: Record<string, unknown>
    try {
      form = await c.req.parseBody()
    } catch {
      throw new AppError(400, 'validation_failed', 'Request body is not valid multipart form data')
    }
    const file = form.file
    if (!(file instanceof File)) throw new AppError(400, 'validation_failed', 'file: a file is required')
    const folder = parse(folderPath.default(''), typeof form.folderPath === 'string' ? form.folderPath : undefined)
    const upload = await readTextUpload(file)
    return c.json(
      repo.create({
        title: upload.title,
        body: upload.body,
        kind: 'file',
        folderPath: folder,
        defaultIncluded: false,
        sourceName: upload.sourceName,
        mimeType: upload.mimeType,
      }),
      201,
    )
  })
  routes.get('/cards/:id', (c) => c.json(repo.get(idParam(c.req.param('id')))))
  routes.patch('/cards/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    return c.json(repo.update(id, await parseBody(c, updateCardSchema)))
  })
  routes.delete('/cards/:id', (c) => {
    repo.archive(idParam(c.req.param('id')))
    return c.body(null, 204)
  })
  routes.post('/cards/:id/restore', (c) => c.json(repo.restore(idParam(c.req.param('id')))))
  routes.get('/cards/:id/versions', (c) => c.json(repo.versions(idParam(c.req.param('id')))))

  routes.post('/merges/preview', async (c) => {
    const { targetId, sourceIds } = await parseBody(c, previewMergeSchema)
    return c.json(merges.preview(targetId, sourceIds))
  })
  routes.post('/merges', async (c) => c.json(merges.merge(await parseBody(c, createMergeSchema)), 201))
  routes.post('/merges/:id/undo', (c) => c.json(merges.undo(idParam(c.req.param('id')))))

  routes.post('/links', async (c) => {
    const { sourceId, targetId, kind, label } = await parseBody(c, createLinkSchema)
    return c.json(repo.createLink({ sourceId, targetId, kind, label: label ?? null }), 201)
  })
  routes.patch('/links/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    return c.json(repo.updateLink(id, await parseBody(c, updateLinkSchema)))
  })
  routes.delete('/links/:id', (c) => {
    repo.deleteLink(idParam(c.req.param('id')))
    return c.body(null, 204)
  })

  routes.get('/graph', (c) => c.json(repo.graph(parseQuery(c, graphQuerySchema))))
  routes.put('/graph/positions', async (c) => {
    repo.setPositions((await parseBody(c, positionsSchema)).positions)
    return c.body(null, 204)
  })

  return routes
}
