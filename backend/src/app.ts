import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { originGuard, type OriginGuardOptions } from './auth/index.ts'
import { ablationRoutes, createTransformersEmbedder, embeddingCacheDir, type Embedder } from './ablation/index.ts'
import { agentRoutes, createSdkRunner, type AgentRunner } from './agent/index.ts'
import { cardRoutes } from './card/routes.ts'
import { chatRoutes } from './chat/routes.ts'
import { handleError, handleNotFound } from './common/errors.ts'
import type { LlmClient } from './llm/index.ts'
import { rulesRoutes } from './rules/index.ts'
import { settingsRoutes } from './settings/index.ts'

/** Everything the routes need from the outside. Tests pass an in-memory database and a stub LLM. */
export type Dependencies = {
  db: DatabaseSync
  llm?: LlmClient
  /** Host/Origin check (`403 forbidden_origin`). `main.ts` always sets it; tests leave it out unless they test the check. */
  /** Embedding model for the ablation. Default: local Transformers.js model, loaded on first use. Tests pass a fake. */
  embedder?: Embedder
  security?: OriginGuardOptions
  /** Coding agent for Agent mode. Default: the real one through the Claude Agent SDK. Tests and end-to-end tests pass the fake. */
  agentRunner?: AgentRunner
  /** Folder with the built frontend (`frontend/dist`). If set, it is served at `/` with an `index.html` fallback for client-side routes. */
  frontendDist?: string
  /** Folder for the embedding model. Default: `EMBEDDING_CACHE_DIR` from the environment, else next to the database file. */
  embeddingCacheDir?: string
}

export function createApp(deps: Dependencies): Hono {
  // All routes live under /api, so the frontend dev proxy (and later the desktop app) can tell them from static files.
  const api = new Hono()
  api.get('/health', (c) => c.json({ status: 'ok', apiKeyConfigured: deps.llm !== undefined }))
  api.route('/', cardRoutes(deps.db))
  api.route('/', chatRoutes(deps.db, deps.llm))
  api.route('/', settingsRoutes(deps.db))
  const embedder = deps.embedder ?? createTransformersEmbedder({ cacheDir: deps.embeddingCacheDir ?? embeddingCacheDir(deps.db) })
  api.route('/', ablationRoutes(deps.db, deps.llm, embedder))
  api.route('/', rulesRoutes(deps.db, deps.llm))
  api.route('/', agentRoutes(deps.db, deps.agentRunner ?? createSdkRunner()))

  const app = new Hono()
  if (deps.security) app.use('*', originGuard(deps.security))
  app.route('/api', api)
  if (deps.frontendDist) {
    const root = deps.frontendDist
    // index.html must be checked on every start, or the window keeps an old build from its cache after an update. The files
    // under /assets carry a content hash in their name and never change.
    app.use('*', async (c, next) => {
      await next()
      const path = c.req.path
      if (path === '/api' || path.startsWith('/api/') || c.res.status !== 200 || c.res.headers.has('cache-control')) return
      c.res.headers.set('cache-control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    })
    app.use('*', serveStatic({ root }))
    // Client-side routes (`/chat/c1`, `/graph`) are not files: answer GETs below with index.html, but never for /api or for
    // paths that look like a missing file (`/assets/x.js`), which should stay a 404.
    app.get('*', async (c, next) => {
      const path = c.req.path
      if (path === '/api' || path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return next()
      return serveStatic({ root, path: 'index.html' })(c, next)
    })
  }
  app.onError(handleError)
  app.notFound(handleNotFound)
  return app
}
