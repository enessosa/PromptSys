import { describe, expect, it } from 'vitest'
import { AppError } from '../common/errors.ts'
import { createStubLlm, createTestApp, type StubReply } from '../testing.ts'
import { createChatRepository } from './repository.ts'

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper: shapes are checked by the assertions
type SseEvent = { event: string; data: Json }

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '' && !block.startsWith(':'))
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? ''
      const data = /^data: (.*)$/m.exec(block)?.[1]
      return { event, data: data === undefined ? undefined : JSON.parse(data) }
    })
}

function setup(...replies: StubReply[]) {
  const llm = createStubLlm(...(replies.length ? replies : ['stub answer']))
  const { app, db } = createTestApp(llm)
  const request = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await request(method, path, body)
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as Json }
  }
  const stream = async (path: string, body: unknown) => {
    const res = await request('POST', path, body)
    const events = res.headers.get('content-type')?.startsWith('text/event-stream') ? parseSse(await res.text()) : []
    return { status: res.status, events, raw: res }
  }
  const card = async (title: string, extra: Record<string, unknown> = {}) => (await send('POST', '/cards', { title, ...extra })).body
  const conversation = async (extra: Record<string, unknown> = {}) => (await send('POST', '/conversations', extra)).body as Json
  return { app, db, llm, send, stream, card, conversation, request }
}

const names = (events: SseEvent[]) => events.map((e) => e.event)
const text = (events: SseEvent[]) => events.filter((e) => e.event === 'text_delta').map((e) => e.data.text).join('')

describe('conversations', () => {
  it('creates a conversation with its first timeline main', async () => {
    const { send } = setup()
    const res = await send('POST', '/conversations', { systemPrompt: 'Be brief.' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 1, title: 'New conversation', systemPrompt: 'Be brief.', model: null, activeTimelineId: 1, showDerivedRules: false })
    const tree = await send('GET', '/conversations/1/tree')
    expect(tree.body.timelines).toMatchObject([{ id: 1, name: 'main', headMessageId: null, branchPointId: null }])
    expect(tree.body.messages).toEqual([])
  })

  it('lists, reads, patches and deletes', async () => {
    const { send, conversation } = setup()
    await conversation({ title: 'A' })
    await conversation({ title: 'B' })
    expect((await send('GET', '/conversations')).body.map((c: Json) => c.title).sort()).toEqual(['A', 'B'])
    const patched = await send('PATCH', '/conversations/1', { title: 'Renamed', model: 'm-1', showDerivedRules: true })
    expect(patched.body).toMatchObject({ title: 'Renamed', model: 'm-1', showDerivedRules: true })
    expect((await send('PATCH', '/conversations/1', { model: null })).body.model).toBeNull()
    expect((await send('DELETE', '/conversations/1')).status).toBe(204)
    expect((await send('GET', '/conversations/1')).body.error.code).toBe('conversation_not_found')
    expect((await send('GET', '/conversations')).body).toHaveLength(1)
  })

  it('validates input and the active timeline', async () => {
    const { send, conversation } = setup()
    await conversation()
    await conversation()
    expect((await send('PATCH', '/conversations/1', {})).status).toBe(400)
    expect((await send('PATCH', '/conversations/1', { title: '' })).body.error.code).toBe('validation_failed')
    // timeline 2 belongs to conversation 2
    const res = await send('PATCH', '/conversations/1', { activeTimelineId: 2 })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('timeline_not_found')
    expect((await send('PATCH', '/conversations/99', { title: 'x' })).body.error.code).toBe('conversation_not_found')
  })

  it('deletes messages with the conversation', async () => {
    const { send, stream, conversation, db } = setup()
    await conversation()
    await stream('/timelines/1/messages', { content: 'hi' })
    expect((await send('DELETE', '/conversations/1')).status).toBe(204)
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM message_cards').get()).toEqual({ n: 0 })
  })
})

describe('sending a message', () => {
  it('streams events in order and saves both messages', async () => {
    const { stream, send, conversation } = setup(['Hello ', 'world'])
    await conversation()
    const res = await stream('/timelines/1/messages', { content: 'Say hi' })
    expect(res.status).toBe(200)
    expect(res.raw.headers.get('content-type')).toContain('text/event-stream')
    expect(names(res.events)).toEqual(['message_start', 'text_delta', 'text_delta', 'message_stop'])
    expect(res.events[0].data).toEqual({ userMessageId: 1, assistantMessageId: 2, timelineId: 1, cards: [], droppedCardIds: [] })
    expect(res.events.at(-1)?.data).toMatchObject({ stopReason: 'end_turn', usedCardIds: [], unusedCardIds: [], invalidMarkers: [] })
    expect(res.events.at(-1)?.data.usage.outputTokens).toBeGreaterThan(0)

    const messages = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ id: 1, parentId: null, role: 'user', content: 'Say hi', status: 'complete', context: [] })
    expect(messages[1]).toMatchObject({ id: 2, parentId: 1, role: 'assistant', content: 'Hello world', status: 'complete', stopReason: 'end_turn', model: 'stub-model', context: null })
    expect((await send('GET', '/conversations/1')).body.title).toBe('Say hi')
  })

  it('sends assembled context to the model and reports citations', async () => {
    const { stream, send, card, conversation, llm } = setup(['Fields are required [c1]. ', 'Also [c', '2] and [c9] and [c1].'])
    const a = await card('Field rules', { body: 'Required by default.' })
    const b = await card('Unused', { body: 'Nothing.' })
    const c = await card('Left out', { body: 'Excluded text.' })
    await conversation({ systemPrompt: 'Answer in German.' })
    const res = await stream('/timelines/1/messages', {
      content: 'What about fields?',
      cards: [
        { cardId: a.id, state: 'pinned' },
        { cardId: b.id, state: 'included' },
        { cardId: c.id, state: 'excluded' },
      ],
    })
    expect(res.events[0].data.cards).toEqual([
      { cardId: 1, version: 1, state: 'pinned' },
      { cardId: 2, version: 1, state: 'included' },
    ])
    const request = llm.requests[0]
    expect(request.system).toContain('<card id="c1" kind="note" title="Field rules">\nRequired by default.\n</card>')
    expect(request.system).toContain('id="c2"')
    expect(request.system).not.toContain('Excluded text.')
    expect(request.system?.endsWith('Answer in German.')).toBe(true)
    expect(request.messages).toEqual([{ role: 'user', content: 'What about fields?' }])

    expect(text(res.events)).toBe('Fields are required [c1]. Also [c2] and [c9] and [c1].')
    const citations = res.events.filter((e) => e.event === 'citation').map((e) => e.data)
    expect(citations).toEqual([
      { cardId: 1, marker: '[c1]', start: 20, end: 24, valid: true },
      { cardId: 2, marker: '[c2]', start: 31, end: 35, valid: true },
      { cardId: null, marker: '[c9]', start: 40, end: 44, valid: false },
      { cardId: 1, marker: '[c1]', start: 49, end: 53, valid: true },
    ])
    expect(res.events.at(-1)?.data).toMatchObject({ usedCardIds: [1, 2], unusedCardIds: [], invalidMarkers: ['[c9]'] })

    const messages = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(messages[0].context.map((x: Json) => [x.cardId, x.state, x.version, x.title])).toEqual([
      [1, 'pinned', 1, 'Field rules'],
      [2, 'included', 1, 'Unused'],
      [3, 'excluded', 1, 'Left out'],
    ])
    expect(messages[1].citations).toEqual(citations)
    expect(messages[1].usedCardIds).toEqual([1, 2])
    expect(messages[1].invalidMarkers).toEqual(['[c9]'])
  })

  it('stores unused cards and invalid citations of excluded cards', async () => {
    const { stream, send, card, conversation } = setup('Only [c2] and [c1].')
    const a = await card('A')
    const b = await card('B')
    await conversation()
    const res = await stream('/timelines/1/messages', { content: 'q', cards: [{ cardId: a.id, state: 'included' }, { cardId: b.id, state: 'excluded' }] })
    expect(res.events.at(-1)?.data).toMatchObject({ usedCardIds: [1], unusedCardIds: [], invalidMarkers: ['[c2]'] })
    const citations = (await send('GET', '/timelines/1/messages')).body[1].citations
    expect(citations).toMatchObject([{ cardId: 2, valid: false }, { cardId: 1, valid: true }])
  })

  it('resolves citations of merged-away cards to the target', async () => {
    const { stream, card, conversation, db } = setup('See [c1].')
    await card('Old')
    const target = await card('New')
    db.prepare('UPDATE cards SET merged_into_id = ? WHERE id = 1').run(target.id)
    await conversation()
    const res = await stream('/timelines/1/messages', { content: 'q', cards: [{ cardId: target.id, state: 'included' }] })
    expect(res.events.find((e) => e.event === 'citation')?.data).toMatchObject({ cardId: 2, marker: '[c1]', valid: true })
    expect(res.events.at(-1)?.data.usedCardIds).toEqual([2])
  })

  it('carries the context forward and includes the history', async () => {
    const { stream, send, card, conversation, llm } = setup('first answer', 'second answer')
    const a = await card('A')
    const b = await card('B')
    await conversation()
    await stream('/timelines/1/messages', { content: 'one', cards: [{ cardId: a.id, state: 'pinned' }, { cardId: b.id, state: 'excluded' }] })
    const res = await stream('/timelines/1/messages', { content: 'two' })
    expect(res.events[0].data.cards).toEqual([{ cardId: 1, version: 1, state: 'pinned' }])
    expect(llm.requests[1].messages).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'two' },
    ])
    expect(llm.requests[1].system).not.toContain('id="c1"'.replace('1', '2')) // c2 stays excluded
    const messages = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(messages[2].context.map((x: Json) => [x.cardId, x.state])).toEqual([[1, 'pinned'], [2, 'excluded']])
  })

  it('uses the current card version when the context carries forward', async () => {
    const { stream, send, card, conversation, llm } = setup()
    const a = await card('A', { body: 'old text' })
    await conversation()
    await stream('/timelines/1/messages', { content: 'one', cards: [{ cardId: a.id, state: 'included' }] })
    await send('PATCH', `/cards/${a.id}`, { body: 'new text' })
    const res = await stream('/timelines/1/messages', { content: 'two' })
    expect(res.events[0].data.cards).toEqual([{ cardId: 1, version: 2, state: 'included' }])
    expect(llm.requests[1].system).toContain('new text')
    const messages = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(messages[0].context[0].version).toBe(1) // the first turn keeps the exact text that was sent
  })

  it('starts the first message with the default-included cards', async () => {
    const { stream, card, conversation } = setup()
    await card('Rule', { defaultIncluded: true })
    await card('Other')
    const archived = await card('Gone', { defaultIncluded: true })
    await conversation()
    const res = await stream('/timelines/1/messages', { content: 'hi' })
    expect(res.events[0].data.cards.map((c: Json) => c.cardId)).toEqual([1, archived.id])
  })

  it('omits archived cards from the default context', async () => {
    const { stream, send, card, conversation } = setup()
    await card('Rule', { defaultIncluded: true })
    const gone = await card('Gone', { defaultIncluded: true })
    await send('DELETE', `/cards/${gone.id}`)
    await conversation()
    const res = await stream('/timelines/1/messages', { content: 'hi' })
    expect(res.events[0].data.cards.map((c: Json) => c.cardId)).toEqual([1])
  })

  it('rejects bad card lists and bodies', async () => {
    const { stream, send, card, conversation } = setup()
    const a = await card('A')
    const gone = await card('Gone')
    await send('DELETE', `/cards/${gone.id}`)
    await conversation()
    const post = async (body: unknown) => (await stream('/timelines/1/messages', body)).raw
    expect((await post({ content: 'x', cards: [{ cardId: 99, state: 'included' }] })).status).toBe(404)
    expect((await post({ content: 'x', cards: [{ cardId: gone.id, state: 'included' }] })).status).toBe(409)
    expect((await post({ content: 'x', cards: [{ cardId: a.id, state: 'included' }, { cardId: a.id, state: 'pinned' }] })).status).toBe(400)
    expect((await post({ content: 'x', cards: [{ cardId: a.id, state: 'maybe' }] })).status).toBe(400)
    expect((await post({ content: '   ' })).status).toBe(400)
    expect((await stream('/timelines/9/messages', { content: 'x' })).raw.status).toBe(404)
    expect((await send('GET', '/timelines/1/messages')).body).toEqual([]) // nothing was saved
  })

  it('answers 424 api_key_missing without an LLM and saves nothing', async () => {
    const { app, db } = createTestApp(null)
    await app.request('/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const res = await app.request('/api/timelines/1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hi' }) })
    expect(res.status).toBe(424)
    expect(((await res.json()) as Json).error.code).toBe('api_key_missing')
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 })
  })

  it('rejects a request whose pinned cards exceed the budget before saving anything', async () => {
    const { stream, card, conversation, db } = setup()
    const big = await card('Big', { body: 'x'.repeat(200_000) })
    const big2 = await card('Big 2', { body: 'x'.repeat(200_000) })
    const big3 = await card('Big 3', { body: 'x'.repeat(200_000) })
    await conversation()
    const res = await stream('/timelines/1/messages', {
      content: 'q',
      cards: [big, big2, big3].map((c) => ({ cardId: c.id, state: 'pinned' })),
    })
    expect(res.status).toBe(400)
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 })
  })

  it('keeps the partial answer and sends an error event when the model fails', async () => {
    const failing = async function* () {
      yield 'Partial [c'
      throw new AppError(429, 'llm_rate_limited', 'Slow down.')
    }
    const { stream, send, conversation } = setup(failing)
    await conversation()
    const res = await stream('/timelines/1/messages', { content: 'q' })
    expect(names(res.events).at(-1)).toBe('error')
    expect(res.events.at(-1)?.data.error).toMatchObject({ code: 'llm_rate_limited', message: 'Slow down.', requestId: expect.any(String) })
    expect(res.events.some((e) => e.event === 'message_stop')).toBe(false)
    expect(text(res.events)).toBe('Partial [c') // the held-back part is released before the error
    const messages = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(messages[1]).toMatchObject({ status: 'error', errorCode: 'llm_rate_limited', content: 'Partial [c' })
  })

  it('skips failed empty answers in the history of the next turn', async () => {
    const failing = async function* (): AsyncGenerator<string> {
      yield* []
      throw new AppError(502, 'llm_error', 'down')
    }
    const { stream, conversation, llm } = setup(failing, 'ok')
    await conversation()
    await stream('/timelines/1/messages', { content: 'one' })
    await stream('/timelines/1/messages', { content: 'two' })
    expect(llm.requests[1].messages.map((m) => m.role)).toEqual(['user', 'user'])
  })

  it('refuses a second message while an answer is streaming', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow = async function* () {
      yield 'start'
      await gate
      yield ' end'
    }
    const { request, send, stream, conversation } = setup(slow, 'second')
    await conversation()
    const first = await request('POST', '/timelines/1/messages', { content: 'one' })
    const reader = first.body!.getReader()
    await reader.read() // message_start arrives
    const second = await send('POST', '/timelines/1/messages', { content: 'two' })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('generation_running')
    expect((await send('DELETE', '/conversations/1')).body.error.code).toBe('generation_running')
    release()
    while (!(await reader.read()).done) { /* drain */ }
    expect((await stream('/timelines/1/messages', { content: 'two' })).status).toBe(200)
  })
})

describe('stopping', () => {
  it('aborts the request, saves the partial answer as stopped and sends no further event', async () => {
    const hanging = async function* (_request: unknown, signal: AbortSignal) {
      yield 'Hello [c1] wor'
      if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve))
    }
    const { request, send, card, conversation } = setup(hanging)
    await card('A')
    await conversation()
    const res = await request('POST', '/timelines/1/messages', { content: 'q', cards: [{ cardId: 1, state: 'included' }] })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('event: citation')) {
      const r = await reader.read()
      if (r.done) throw new Error(`stream ended early: ${seen}`)
      seen += decoder.decode(r.value)
    }
    const stop = await send('POST', '/messages/2/stop')
    expect(stop.status).toBe(204)
    for (let r = await reader.read(); !r.done; r = await reader.read()) seen += decoder.decode(r.value)
    expect(parseSse(seen).map((e) => e.event)).toEqual(['message_start', 'text_delta', 'text_delta', 'citation', 'text_delta'])
    expect(seen).not.toContain('message_stop')
    expect(seen).not.toContain('event: error')

    const messages = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(messages[1]).toMatchObject({ status: 'stopped', content: 'Hello [c1] wor', errorCode: null })
    expect(messages[1].citations).toMatchObject([{ cardId: 1, valid: true, start: 6, end: 10 }])
    // the registry is free again
    expect((await send('POST', '/messages/2/stop')).status).toBe(204)
  })

  it('answers 404 for unknown messages and 204 for finished ones', async () => {
    const { send, stream, conversation } = setup()
    await conversation()
    await stream('/timelines/1/messages', { content: 'q' })
    expect((await send('POST', '/messages/2/stop')).status).toBe(204)
    expect((await send('POST', '/messages/99/stop')).body.error.code).toBe('message_not_found')
  })
})

describe('context preview', () => {
  it('returns the same prompt that is sent', async () => {
    const { send, stream, card, conversation, llm } = setup()
    await card('A', { body: 'alpha', defaultIncluded: true })
    await card('B', { body: 'beta' })
    await conversation({ systemPrompt: 'Be nice.' })
    const body = { timelineId: 1, content: 'question', cards: [{ cardId: 2, state: 'pinned' }, { cardId: 1, state: 'included' }] }
    const preview = await send('POST', '/conversations/1/context-preview', body)
    expect(preview.status).toBe(200)
    expect(preview.body.cards.map((c: Json) => [c.cardId, c.state, c.title])).toEqual([[2, 'pinned', 'B'], [1, 'included', 'A']])
    expect(preview.body.estimatedInputTokens).toBeGreaterThan(0)
    await stream('/timelines/1/messages', { content: 'question', cards: body.cards })
    expect(preview.body.prompt).toEqual({ system: llm.requests[0].system, messages: llm.requests[0].messages })
    expect(preview.body.prompt.system.indexOf('id="c2"')).toBeLessThan(preview.body.prompt.system.indexOf('id="c1"'))
  })

  it('uses the defaults without a card list and works without text', async () => {
    const { send, card, conversation } = setup()
    await card('A', { defaultIncluded: true })
    await conversation()
    const preview = await send('POST', '/conversations/1/context-preview', { timelineId: 1 })
    expect(preview.body.cards).toMatchObject([{ cardId: 1, state: 'included' }])
    expect(preview.body.prompt.messages).toEqual([])
  })

  it('checks the timeline belongs to the conversation', async () => {
    const { send, conversation } = setup()
    await conversation()
    await conversation()
    expect((await send('POST', '/conversations/1/context-preview', { timelineId: 2 })).body.error.code).toBe('timeline_not_found')
    expect((await send('POST', '/conversations/9/context-preview', { timelineId: 1 })).status).toBe(404)
  })

  it('shows dropped cards when over budget', async () => {
    const { send, card, conversation } = setup()
    const cards = []
    for (let i = 0; i < 4; i++) cards.push(await card(`Big ${i}`, { body: 'x'.repeat(190_000) }))
    await conversation()
    const preview = await send('POST', '/conversations/1/context-preview', {
      timelineId: 1,
      cards: cards.map((c, i) => ({ cardId: c.id, state: i === 0 ? 'pinned' : 'included' })),
    })
    expect(preview.body.droppedCardIds.length).toBeGreaterThan(0)
    expect(preview.body.droppedCardIds).not.toContain(1)
  })
})

describe('regenerate and timelines', () => {
  async function answered() {
    const s = setup('first answer [c1][c2]', 'second answer [c2]')
    await s.card('A', { body: 'alpha' })
    await s.card('B', { body: 'beta' })
    await s.conversation()
    await s.stream('/timelines/1/messages', { content: 'q', cards: [{ cardId: 1, state: 'included' }, { cardId: 2, state: 'pinned' }] })
    return s
  }

  it('creates a sibling answer in a new timeline', async () => {
    const { stream, send, llm } = await answered()
    const res = await stream('/messages/2/regenerate', {})
    expect(res.events[0].data).toMatchObject({ userMessageId: 1, assistantMessageId: 3, timelineId: 2 })
    expect(llm.requests[1].system).toEqual(llm.requests[0].system)
    const tree = (await send('GET', '/conversations/1/tree')).body
    expect(tree.timelines).toMatchObject([
      { id: 1, headMessageId: 2 },
      { id: 2, parentTimelineId: 1, branchPointId: 1, headMessageId: 3, changeSummary: null },
    ])
    expect(tree.messages.map((m: Json) => [m.id, m.parentId, m.timelineIds])).toEqual([[1, null, [1, 2]], [2, 1, [1]], [3, 1, [2]]])
    expect((await send('GET', '/timelines/1/messages')).body[1].content).toBe('first answer [c1][c2]')
    expect((await send('GET', '/timelines/2/messages')).body[1].content).toBe('second answer [c2]')
    expect((await send('GET', '/conversations/1')).body.activeTimelineId).toBe(2)
  })

  it('excludes cards by copying the question with the changed context', async () => {
    const { stream, send, llm } = await answered()
    const res = await stream('/messages/2/regenerate', { excludeCardIds: [2] })
    expect(res.events[0].data).toMatchObject({ userMessageId: 3, assistantMessageId: 4, timelineId: 2, cards: [{ cardId: 1, version: 1, state: 'included' }] })
    expect(llm.requests[1].system).not.toContain('id="c2"')
    expect(llm.requests[1].system).toContain('id="c1"')
    expect(llm.requests[1].messages).toEqual([{ role: 'user', content: 'q' }])
    // c2 is cited by the new answer but excluded: invalid
    expect(res.events.find((e) => e.event === 'citation')?.data).toMatchObject({ cardId: 2, valid: false })

    const tree = (await send('GET', '/conversations/1/tree')).body
    expect(tree.timelines[1]).toMatchObject({ name: 'Without c2', changeSummary: 'excluded c2', branchPointId: null, headMessageId: 4 })
    const messages = (await send('GET', '/timelines/2/messages')).body as Json[]
    expect(messages[0]).toMatchObject({ id: 3, replayOfId: 1, content: 'q' })
    expect(messages[0].context.map((c: Json) => [c.cardId, c.state])).toEqual([[1, 'included'], [2, 'excluded']])
    // the original turn is untouched
    expect((await send('GET', '/timelines/1/messages')).body[0].context.map((c: Json) => c.state)).toEqual(['included', 'pinned'])
  })

  it('rejects unknown cards and non-answers', async () => {
    const { stream, send } = await answered()
    expect((await stream('/messages/2/regenerate', { excludeCardIds: [7] })).raw.status).toBe(400)
    expect((await stream('/messages/1/regenerate', {})).raw.status).toBe(400)
    expect((await send('POST', '/messages/99/regenerate', {})).body.error.code).toBe('message_not_found')
  })

  it('continues a regenerated timeline with the history of that branch', async () => {
    const { stream, llm } = await answered()
    await stream('/messages/2/regenerate', {})
    await stream('/timelines/2/messages', { content: 'follow-up' })
    expect(llm.requests[2].messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'second answer [c2]' },
      { role: 'user', content: 'follow-up' },
    ])
  })

  it('creates a branch after an answer and continues from there', async () => {
    const { stream, send, llm } = await answered()
    await stream('/timelines/1/messages', { content: 'second question' })
    const branch = await send('POST', '/conversations/1/timelines', { fromMessageId: 2, name: 'Alt' })
    expect(branch.status).toBe(201)
    expect(branch.body).toMatchObject({ id: 2, name: 'Alt', parentTimelineId: 1, branchPointId: 2, headMessageId: 2 })
    await stream('/timelines/2/messages', { content: 'different question' })
    expect(llm.requests[2].messages.map((m) => m.content)).toEqual(['q', 'first answer [c1][c2]', 'different question'])
    const tree = (await send('GET', '/conversations/1/tree')).body
    expect(tree.messages.filter((m: Json) => m.parentId === 2).map((m: Json) => m.timelineIds)).toEqual([[1], [2]])
    expect((await send('POST', '/conversations/1/timelines', { fromMessageId: 99 })).body.error.code).toBe('message_not_found')
  })

  it('marks answers left streaming by a crashed run as failed', async () => {
    const { db, conversation } = setup()
    await conversation()
    db.exec("INSERT INTO messages (conversation_id, role, content, status) VALUES (1, 'assistant', 'half', 'streaming')")
    expect(createChatRepository(db).markInterrupted()).toBe(1)
    expect(db.prepare('SELECT status, error_code FROM messages').get()).toEqual({ status: 'error', error_code: 'interrupted' })
  })
})

describe('search', () => {
  it('finds cards by title and body and conversations by title', async () => {
    const { send, card, conversation } = setup()
    await card('Zod schemas', { body: 'validation' })
    await card('Notes', { body: 'we use zod for 100% of input' })
    await card('Other', { body: 'nothing' })
    const archived = await card('Zod old')
    await send('DELETE', `/cards/${archived.id}`)
    await conversation({ title: 'About ZOD' })
    await conversation({ title: 'Else' })
    const res = (await send('GET', '/search?q=zod')).body
    expect(res.cards.map((c: Json) => c.title)).toEqual(['Zod schemas', 'Notes']) // title matches first
    expect(res.cards[1]).toMatchObject({ kind: 'note', folderPath: '', excerpt: 'we use zod for 100% of input' })
    expect(res.conversations.map((c: Json) => c.title)).toEqual(['About ZOD'])
  })

  it('treats % and _ literally and an empty query as no result', async () => {
    const { send, card } = setup()
    await card('100% sure', {})
    await card('plain')
    expect((await send('GET', '/search?q=%25')).body.cards.map((c: Json) => c.title)).toEqual(['100% sure'])
    expect((await send('GET', '/search?q=_')).body.cards).toEqual([])
    expect((await send('GET', '/search')).body).toEqual({ cards: [], conversations: [] })
  })
})
