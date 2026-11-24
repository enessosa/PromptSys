import { describe, expect, it } from 'vitest'
import { createStubLlm, createTestApp } from './testing.ts'

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })
})

describe('test setup', () => {
  it('uses a fresh in-memory database per app', () => {
    const a = createTestApp()
    const b = createTestApp()
    a.db.exec('CREATE TABLE only_in_a (id INTEGER)')
    expect(b.db.prepare("SELECT name FROM sqlite_master WHERE name = 'only_in_a'").get()).toBeUndefined()
  })

  it('stubs the Claude client without a network call', async () => {
    const llm = createStubLlm('one', 'two')
    expect(await llm.complete({ messages: [{ role: 'user', content: 'hi' }] })).toEqual({ text: 'one' })
    expect((await llm.complete({ messages: [] })).text).toBe('two')
    expect((await llm.complete({ messages: [] })).text).toBe('two')
    expect(llm.requests).toHaveLength(3)
  })
})

describe('GET /api/health', () => {
  it('reports whether an API key is configured', async () => {
    const { app } = createTestApp()
    expect(await (await app.request('/api/health')).json()).toEqual({ status: 'ok', apiKeyConfigured: true })
  })
})

describe('stub LLM streaming', () => {
  it('streams chunks (also markers split across chunks) and ends with usage', async () => {
    const llm = createStubLlm(['see [c', '3] ok'])
    const events = []
    for await (const event of llm.stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)) events.push(event)
    expect(events.slice(0, 2)).toEqual([{ type: 'text', text: 'see [c' }, { type: 'text', text: '3] ok' }])
    expect(events[2]).toMatchObject({ type: 'done', stopReason: 'end_turn' })
    expect(await llm.complete({ messages: [] })).toEqual({ text: 'see [c3] ok' })
  })

  it('throws when the signal is aborted', async () => {
    const controller = new AbortController()
    const llm = createStubLlm(['a', 'b'])
    const seen: string[] = []
    await expect(async () => {
      for await (const event of llm.stream({ messages: [] }, controller.signal)) {
        if (event.type === 'text') seen.push(event.text)
        controller.abort()
      }
    }).rejects.toThrow()
    expect(seen).toEqual(['a'])
  })
})

describe('chat without an API key', () => {
  it('reports the missing key in /api/health', async () => {
    const { app } = createTestApp(null)
    expect(await (await app.request('/api/health')).json()).toEqual({ status: 'ok', apiKeyConfigured: false })
  })
})
