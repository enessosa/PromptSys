import { serve } from '@hono/node-server'
import { createFakeRunner, createSdkRunner, resetStaleSessions } from './agent/index.ts'
import { createApp } from './app.ts'
import { createChatRepository } from './chat/repository.ts'
import { loadSettings } from './common/config.ts'
import { migrate, openDatabase } from './db/index.ts'
import { createFakeEmbedder, createFakeLlm, fakeModeEnabled } from './llm/fake.ts'
import { createLlmClient } from './llm/index.ts'

const settings = loadSettings()
const db = openDatabase(settings.dbUrl)
migrate(db)
// Answers that were streaming when the process stopped can never finish.
const interrupted = createChatRepository(db).markInterrupted()
if (interrupted > 0) console.warn(`Marked ${interrupted} unfinished answer(s) from the last run as failed.`)

const staleSessions = resetStaleSessions(db)
if (staleSessions > 0) console.warn(`Marked ${staleSessions} unfinished agent session(s) from the last run as stopped.`)

// Fake mode (end-to-end tests): fixed answers instead of the Claude API, a hashed bag of words instead of the embedding model.
const fake = fakeModeEnabled(settings.fakeLlm, process.env.NODE_ENV)
if (fake) console.warn('PROMPTSYS_FAKE_LLM is on: answers are fake, the Claude API is not called.')
const llm = fake ? createFakeLlm() : createLlmClient(settings)
const fakeAgent = fakeModeEnabled(process.env.PROMPTSYS_FAKE_AGENT === '1', process.env.NODE_ENV)
if (fakeAgent) console.warn('PROMPTSYS_FAKE_AGENT is on: agent sessions use a scripted fake agent.')
// The Vite dev server (port 5173) is allowed as Host/Origin unless NODE_ENV=production.
const app = createApp({
  db,
  llm,
  security: { port: settings.port, development: process.env.NODE_ENV !== 'production' },
  agentRunner: fakeAgent ? createFakeRunner() : createSdkRunner(),
  frontendDist: settings.frontendDist,
  embeddingCacheDir: settings.embeddingCacheDir,
  ...(fake ? { embedder: createFakeEmbedder() } : {}),
})

serve({ fetch: app.fetch, port: settings.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`PromptSys backend on http://127.0.0.1:${info.port}`)
  if (!llm) console.warn('ANTHROPIC_API_KEY is not set: chat and ablation are disabled.')
})
