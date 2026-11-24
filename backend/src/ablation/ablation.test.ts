import { describe, expect, it } from 'vitest'
import { AppError } from '../common/errors.ts'
import { createFakeEmbedder, createStubLlm, createTestApp, type StubReply } from '../testing.ts'

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper: shapes are checked by the assertions
type SseEvent = { event: string; data: Json }

const ORIGINAL = 'Fields are required by default because the schema says so'
const OTHER = 'Completely unrelated zebra banana sentence'

const parseSse = (text: string): SseEvent[] =>
  text
    .split('\n\n')
    .filter((b) => b.trim() !== '' && !b.startsWith(':'))
    .map((b) => ({ event: /^event: (.*)$/m.exec(b)?.[1] ?? '', data: JSON.parse(/^data: (.*)$/m.exec(b)?.[1] ?? 'null') }))

/** The first reply is the chat answer; afterwards the model answers like the original unless card c2 is missing. */
const model = (): StubReply[] => [
  ORIGINAL,
  async function* (request) {
    yield request.system?.includes('id="c2"') ? ORIGINAL : OTHER
  },
]

async function setup(llm: ReturnType<typeof createStubLlm> | null = createStubLlm(...model())) {
  const embedder = createFakeEmbedder()
  const { app, db } = createTestApp(llm, embedder)
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const sse = res.headers.get('content-type')?.startsWith('text/event-stream')
    return { status: res.status, body: (sse || !text ? undefined : JSON.parse(text)) as Json, events: sse ? parseSse(text) : [] }
  }
  for (const title of ['Card one', 'Card two', 'Card three']) await send('POST', '/cards', { title, body: `${title} body` })
  await send('POST', '/conversations', { systemPrompt: 'Be brief.' })
  // c1, c2 sent; c3 left out; the answer is message 2.
  await send('POST', '/timelines/1/messages', { content: 'Are fields required?', cards: [{ cardId: 1, state: 'included' }, { cardId: 2, state: 'included' }] })
  return { send, db, embedder, llm }
}

describe('ablation dry run', () => {
  it('estimates k + n x cards without calling the model', async () => {
    const { send, llm } = await setup()
    const before = llm!.requests.length
    const res = await send('POST', '/messages/2/ablations', { cardIds: [1, 2], dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ estimatedApiCalls: 3 + 3 * 2, cardIds: [1, 2], runs: 3, baselineRuns: 3 })
    expect(llm!.requests.length).toBe(before)
  })

  it('uses settings as defaults and lets the request override them', async () => {
    const { send } = await setup()
    await send('PUT', '/settings', { ablationRuns: 2, baselineRuns: 1 })
    expect((await send('POST', '/messages/2/ablations', { cardIds: [1], dryRun: true })).body.estimatedApiCalls).toBe(1 + 2)
    expect((await send('POST', '/messages/2/ablations', { cardIds: [1], runs: 4, baselineRuns: 0, dryRun: true })).body.estimatedApiCalls).toBe(4)
  })
})

describe('ablation run', () => {
  it('streams progress and one result per card, stores every run, labels the cards', async () => {
    const { send, db, llm } = await setup()
    const res = await send('POST', '/messages/2/ablations', { cardIds: [1, 2], runs: 2, baselineRuns: 2 })
    expect(res.status).toBe(200)
    const names = res.events.map((e) => e.event)
    expect(names.filter((n) => n === 'progress')).toHaveLength(6)
    expect(res.events.filter((e) => e.event === 'progress').at(-1)!.data).toMatchObject({ done: 6, total: 6, cardId: 2 })
    expect(res.events.find((e) => e.event === 'progress')!.data).toEqual({ done: 1, total: 6 }) // baseline: no cardId
    expect(names.filter((n) => n === 'ablation_result')).toHaveLength(2)
    expect(names.at(-1)).toBe('message_stop')
    expect(res.events.at(-1)!.data).toMatchObject({ messageId: 2, apiCalls: 6 })

    const results = res.events.filter((e) => e.event === 'ablation_result').map((e) => e.data)
    // c1 is not needed: the answer stays the same. c2 is: without it the answer changes.
    expect(results[0]).toMatchObject({ cardId: 1, runs: 2, label: 'within_noise' })
    expect(results[0].explanation).toMatch(/No effect/)
    expect(results[1]).toMatchObject({ cardId: 2, runs: 2, label: 'strong' })
    expect(results[1].effect).toBeGreaterThan(0.5)

    expect(db.prepare('SELECT COUNT(*) AS n FROM ablation_runs').get()!.n).toBe(6)
    expect(db.prepare('SELECT COUNT(*) AS n FROM ablation_runs WHERE card_id IS NULL').get()!.n).toBe(2)
    // the ablated prompt really lacks the card and uses the configured temperature
    const ablated = llm!.requests.slice(1).filter((r) => !r.system!.includes('id="c1"'))
    expect(ablated).toHaveLength(2)
    expect(llm!.requests.slice(1).every((r) => r.temperature === 0.2)).toBe(true)
    expect(llm!.requests.slice(1).filter((r) => !r.system!.includes('id="c2"'))).toHaveLength(2)
  })

  it('returns the stored scores with GET', async () => {
    const { send } = await setup()
    await send('POST', '/messages/2/ablations', { cardIds: [1, 2], runs: 2, baselineRuns: 2 })
    const res = await send('GET', '/messages/2/ablations')
    expect(res.status).toBe(200)
    expect(res.body.baseline).toMatchObject({ runs: 2, noise: expect.closeTo(0) })
    expect(res.body.cards.map((c: Json) => [c.cardId, c.label, c.runs])).toEqual([[1, 'within_noise', 2], [2, 'strong', 2]])
    expect(res.body.cards[1].answers[0]).toMatchObject({ runIndex: 1, answer: OTHER })
    expect((await send('GET', '/messages/1/ablations')).status).toBe(400) // a user message
  })

  it('reuses existing baseline runs and replaces earlier runs of a card', async () => {
    const { send, db } = await setup()
    await send('POST', '/messages/2/ablations', { cardIds: [1], runs: 2, baselineRuns: 2 })
    const dry = await send('POST', '/messages/2/ablations', { cardIds: [1], runs: 2, baselineRuns: 2, dryRun: true })
    expect(dry.body).toMatchObject({ estimatedApiCalls: 2, reusedBaselineRuns: 2 })
    await send('POST', '/messages/2/ablations', { cardIds: [1], runs: 2, baselineRuns: 2 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM ablation_runs').get()!.n).toBe(4)
  })

  it('works without baseline runs (noise not measured)', async () => {
    const { send } = await setup()
    const res = await send('POST', '/messages/2/ablations', { cardIds: [2], runs: 1, baselineRuns: 0 })
    expect(res.events.find((e) => e.event === 'ablation_result')!.data).toMatchObject({ noise: 0, noiseMeasured: false })
  })

  it('sends an error event when the model fails and keeps the runs already stored', async () => {
    const llm = createStubLlm(ORIGINAL, async function* (request) {
      if (request.system?.includes('id="c2"')) yield ORIGINAL
      else throw new AppError(429, 'llm_rate_limited', 'slow down')
    })
    const { send, db } = await setup(llm)
    const res = await send('POST', '/messages/2/ablations', { cardIds: [2], runs: 2, baselineRuns: 1 })
    expect(res.status).toBe(200)
    expect(res.events.at(-1)!.event).toBe('error')
    expect(res.events.at(-1)!.data.error).toMatchObject({ code: 'llm_rate_limited' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM ablation_runs').get()!.n).toBe(1)
  })

  it('fails before spending API calls when the embedding model is broken', async () => {
    const llm = createStubLlm(...model())
    const { send, embedder } = await setup(llm)
    embedder.embed = async () => {
      throw new Error('model download failed')
    }
    const before = llm.requests.length
    const res = await send('POST', '/messages/2/ablations', { cardIds: [1] })
    expect(res.events.at(-1)!.data.error).toMatchObject({ code: 'internal_error' })
    expect(llm.requests.length).toBe(before)
  })
})

describe('ablation validation', () => {
  it('rejects a card that was not sent with the question (400), also for a dry run', async () => {
    const { send } = await setup()
    for (const dryRun of [true, false]) {
      const res = await send('POST', '/messages/2/ablations', { cardIds: [3], dryRun })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_failed')
    }
  })

  it('rejects bad bodies and wrong messages', async () => {
    const { send } = await setup()
    expect((await send('POST', '/messages/2/ablations', { cardIds: [] })).status).toBe(400)
    expect((await send('POST', '/messages/2/ablations', { cardIds: [1, 1] })).status).toBe(400)
    expect((await send('POST', '/messages/2/ablations', { cardIds: [1], runs: 0 })).status).toBe(400)
    expect((await send('POST', '/messages/1/ablations', { cardIds: [1] })).status).toBe(400) // user message
    expect((await send('POST', '/messages/99/ablations', { cardIds: [1] })).status).toBe(404)
  })

  it('answers 424 api_key_missing without an LLM', async () => {
    const noKey = createTestApp(null)
    const res = await noKey.app.request('/api/messages/1/ablations', { method: 'POST', body: JSON.stringify({ cardIds: [1] }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(424)
    expect(((await res.json()) as Json).error.code).toBe('api_key_missing')
  })
})
