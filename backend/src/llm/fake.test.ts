import { describe, expect, it, vi } from 'vitest'
import type { LlmStreamEvent } from './index.ts'
import { cardIdsOf, createFakeEmbedder, createFakeLlm, fakeChunks, fakeModeEnabled } from './fake.ts'

const system = '<context>\n<card id="c4" kind="note" title="A">x</card>\n<card id="c7" kind="note" title="B">y</card>\n</context>'

describe('fakeModeEnabled', () => {
  it('is off without the flag', () => {
    const log = vi.fn()
    expect(fakeModeEnabled(false, undefined, log)).toBe(false)
    expect(fakeModeEnabled(false, 'production', log)).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('is on with the flag outside production', () => {
    expect(fakeModeEnabled(true, undefined)).toBe(true)
    expect(fakeModeEnabled(true, 'development')).toBe(true)
    expect(fakeModeEnabled(true, 'test')).toBe(true)
  })

  it('is refused in production and logs an error', () => {
    const log = vi.fn()
    expect(fakeModeEnabled(true, 'production', log)).toBe(false)
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0][0]).toContain('production')
  })
})

describe('fake LLM', () => {
  it('reads the card ids from the prompt', () => {
    expect(cardIdsOf(system)).toEqual([4, 7])
    expect(cardIdsOf(undefined)).toEqual([])
  })

  it('cites the first card, with the marker split across chunks', () => {
    const chunks = fakeChunks({ system, messages: [{ role: 'user', content: 'hi' }] })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toContain('[c4]')
    expect(chunks.some((c) => c.includes('[c4]'))).toBe(false)
  })

  it('answers without a citation when no card was sent', () => {
    expect(fakeChunks({ messages: [{ role: 'user', content: 'hi' }] }).join('')).not.toMatch(/\[c\d+\]/)
  })

  it('makes a long reply for the word "long"', () => {
    expect(fakeChunks({ system, messages: [{ role: 'user', content: 'Give a LONG answer' }] }).length).toBeGreaterThan(100)
  })

  it('streams text and ends with one done event', async () => {
    const events: LlmStreamEvent[] = []
    for await (const e of createFakeLlm().stream({ system, messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)) events.push(e)
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end_turn' })
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
  })

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController()
    const run = async () => {
      for await (const e of createFakeLlm().stream({ system, messages: [{ role: 'user', content: 'long' }] }, controller.signal)) {
        if (e.type === 'text') controller.abort()
      }
    }
    await expect(run()).rejects.toThrow()
  })

  it('ablation answers depend on the cards in the prompt', async () => {
    const llm = createFakeLlm()
    const a = await llm.complete({ system, messages: [{ role: 'user', content: 'hi' }] })
    const b = await llm.complete({ system: '<card id="c4" kind="note" title="A">', messages: [{ role: 'user', content: 'hi' }] })
    expect(a.text).not.toBe(b.text)
  })

  it('reports one rule from the first card', async () => {
    const { input } = await createFakeLlm().callTool({
      messages: [{ role: 'user', content: '<cards>\n<card id="c9" title="T">\nbody\n</card>\n</cards>' }],
      tool: { name: 'report_rules', description: '', inputSchema: { type: 'object', properties: {} } },
    })
    expect(input).toEqual({ rules: [{ text: expect.any(String), source: { kind: 'card', cardId: 9 } }] })
  })
})

describe('fake embedder', () => {
  it('gives equal texts cosine 1 and unit vectors', async () => {
    const [a, b] = await createFakeEmbedder().embed(['same words', 'same words'])
    expect(a).toEqual(b)
    expect(Math.hypot(...a)).toBeCloseTo(1)
  })
})
