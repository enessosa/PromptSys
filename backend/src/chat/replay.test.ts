import { describe, expect, it } from 'vitest'
import type { LlmRequest } from '../llm/index.ts'
import { createStubLlm, createTestApp } from '../testing.ts'

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

const lastUser = (request: LlmRequest) => request.messages.at(-1)?.content ?? ''
/** Answers "re: <question>" so every answer shows which prompt it belongs to. */
const echo = async function* (request: LlmRequest) {
  yield `re: ${lastUser(request)}`
}

/** A conversation with three cards and three turns on `main`: messages 1..6 (q1 a1 q2 a2 q3 a3). */
async function chat(reply: Parameters<typeof createStubLlm>[0] = echo) {
  const llm = createStubLlm(reply)
  const { app, db } = createTestApp(llm)
  const request = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await request(method, path, body)
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as Json }
  }
  const stream = async (path: string, body: unknown = {}) => {
    const res = await request('POST', path, body)
    const isSse = res.headers.get('content-type')?.startsWith('text/event-stream')
    const text = await res.text()
    return { status: res.status, events: isSse ? parseSse(text) : [], json: isSse || !text ? undefined : (JSON.parse(text) as Json) }
  }
  await send('POST', '/cards', { title: 'A', body: 'alpha' })
  await send('POST', '/cards', { title: 'B', body: 'beta' })
  await send('POST', '/cards', { title: 'C', body: 'gamma' })
  await send('POST', '/conversations', {})
  await stream('/timelines/1/messages', { content: 'q1', cards: [{ cardId: 1, state: 'included' }, { cardId: 2, state: 'pinned' }, { cardId: 3, state: 'excluded' }] })
  await stream('/timelines/1/messages', { content: 'q2' })
  await stream('/timelines/1/messages', { content: 'q3' })
  llm.requests.length = 0
  return { app, db, llm, send, stream, request }
}

const changes = { cards: [{ cardId: 2, state: 'excluded' }, { cardId: 3, state: 'included' }], editedCards: [{ cardId: 1, body: 'ALPHA EDITED' }] }
const count = (db: ReturnType<typeof createTestApp>['db'], table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('branches with context changes', () => {
  it('forks edited cards, summarises the change and uses the branch context for the next message', async () => {
    const { send, stream, llm, db } = await chat()
    const branch = await send('POST', '/conversations/1/timelines', { fromMessageId: 2, contextChanges: changes })
    expect(branch.status).toBe(201)
    expect(branch.body).toMatchObject({ id: 2, parentTimelineId: 1, branchPointId: 2, headMessageId: 2, changeSummary: 'excluded c2, included c3, edited c1 → c4', replayStatus: null })

    // the fork: new card with forked_from_id, own first version and a derived_from link; the original stays unchanged
    expect(db.prepare('SELECT title, body, forked_from_id, default_included FROM cards WHERE id = 4').get()).toMatchObject({ title: 'A', body: 'ALPHA EDITED', forked_from_id: 1, default_included: 0 })
    expect(db.prepare('SELECT source_id, target_id FROM card_links WHERE kind = ?').get('derived_from')).toMatchObject({ source_id: 4, target_id: 1 })
    expect((await send('GET', '/cards/1')).body).toMatchObject({ body: 'alpha', version: 1 })

    const res = await stream('/timelines/2/messages', { content: 'branch question' })
    expect(res.events[0].data.cards).toEqual([{ cardId: 4, version: 1, state: 'included' }, { cardId: 3, version: 1, state: 'included' }])
    expect(llm.requests[0].system).toContain('ALPHA EDITED')
    expect(llm.requests[0].system).not.toContain('beta')
    expect(llm.requests[0].system).toContain('gamma')
    expect(llm.requests[0].messages.map((m) => m.content)).toEqual(['q1', 're: q1', 'branch question'])
    expect(count(db, 'timeline_context')).toBe(0) // consumed by the first message

    // carried forward afterwards, the original timeline is untouched
    const next = await stream('/timelines/2/messages', { content: 'more' })
    expect(next.events[0].data.cards.map((c: Json) => c.cardId)).toEqual([4, 3])
    const main = (await send('GET', '/timelines/1/messages')).body as Json[]
    expect(main[4].context.map((c: Json) => [c.cardId, c.state])).toEqual([[1, 'included'], [2, 'pinned'], [3, 'excluded']])
  })

  it('shows the pending context in the context preview', async () => {
    const { send } = await chat()
    await send('POST', '/conversations/1/timelines', { fromMessageId: 4, contextChanges: { cards: [{ cardId: 1, state: 'pinned' }] } })
    const preview = await send('POST', '/conversations/1/context-preview', { timelineId: 2, content: 'x' })
    expect(preview.body.cards.map((c: Json) => [c.cardId, c.state])).toEqual([[1, 'pinned'], [2, 'pinned'], [3, 'excluded']])
  })

  it('can branch from the first user message: the branch point is its parent', async () => {
    const { send, stream, llm } = await chat()
    const branch = await send('POST', '/conversations/1/timelines', { fromMessageId: 1, contextChanges: { cards: [{ cardId: 2, state: 'excluded' }], editedCards: [] } })
    expect(branch.body).toMatchObject({ id: 2, parentTimelineId: 1, branchPointId: null, headMessageId: null, changeSummary: 'excluded c2' })
    const res = await stream('/timelines/2/messages', { content: 'new first question' })
    expect(res.events[0].data).toMatchObject({ userMessageId: 7, assistantMessageId: 8, timelineId: 2 })
    expect(llm.requests[0].messages).toEqual([{ role: 'user', content: 'new first question' }])
    expect(llm.requests[0].system).not.toContain('beta')

    const tree = (await send('GET', '/conversations/1/tree')).body
    expect(tree.messages.filter((m: Json) => m.parentId === null).map((m: Json) => [m.id, m.timelineIds])).toEqual([[1, [1]], [7, [2]]])
  })

  it('branches from a later user message with the context of that turn, even without changes', async () => {
    const { send, stream } = await chat()
    await send('POST', '/conversations/1/timelines', { fromMessageId: 3 })
    const res = await stream('/timelines/2/messages', { content: 'alt q2' })
    expect(res.events[0].data.cards.map((c: Json) => [c.cardId, c.state])).toEqual([[1, 'included'], [2, 'pinned']])
    const tree = (await send('GET', '/conversations/1/tree')).body
    expect(tree.timelines[1]).toMatchObject({ branchPointId: 2, headMessageId: 8, changeSummary: null })
  })

  it('adds cards that are not in the context yet and rejects bad changes', async () => {
    const { send, db } = await chat()
    await send('POST', '/cards', { title: 'D', body: 'delta' })
    const ok = await send('POST', '/conversations/1/timelines', { fromMessageId: 2, contextChanges: { cards: [{ cardId: 4, state: 'pinned' }] } })
    expect(ok.body.changeSummary).toBe('added c4')
    const pending = db.prepare('SELECT card_id, state, position FROM timeline_context WHERE timeline_id = 2 ORDER BY position').all()
    expect(pending).toMatchObject([{ card_id: 1 }, { card_id: 2 }, { card_id: 3 }, { card_id: 4, state: 'pinned', position: 3 }])

    const before = count(db, 'cards')
    const post = (contextChanges: unknown) => send('POST', '/conversations/1/timelines', { fromMessageId: 2, contextChanges })
    expect((await post({ cards: [{ cardId: 1, state: 'included' }, { cardId: 1, state: 'pinned' }] })).status).toBe(400)
    expect((await post({ cards: [{ cardId: 99, state: 'included' }] })).body.error.code).toBe('card_not_found')
    expect((await post({ editedCards: [{ cardId: 4, body: 'x' }] })).status).toBe(400)
    expect((await post({ editedCards: [{ cardId: 1 }] })).status).toBe(400)
    expect((await post({ editedCards: [{ cardId: 1, body: 'a' }, { cardId: 1, body: 'b' }] })).status).toBe(400)
    // a failed request leaves no half-made fork behind
    expect((await post({ editedCards: [{ cardId: 1, body: 'x' }], cards: [{ cardId: 99, state: 'included' }] })).status).toBe(404)
    expect(count(db, 'cards')).toBe(before)
    expect(count(db, 'timelines')).toBe(2)
  })
})

describe('creating a replay', () => {
  it('lists the following prompts and creates a paused timeline', async () => {
    const { send, db } = await chat()
    const res = await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes, mode: 'step' })
    expect(res.status).toBe(201)
    expect(res.body.pendingPrompts).toEqual([{ messageId: 3, content: 'q2' }, { messageId: 5, content: 'q3' }])
    expect(res.body.estimatedApiCalls).toBe(2)
    expect(res.body.timeline).toMatchObject({
      id: 2,
      parentTimelineId: 1,
      branchPointId: 2,
      headMessageId: 2,
      replayStatus: 'paused',
      replayMode: 'step',
      replaySourceId: 1,
      replayNextId: 3,
      changeSummary: 'excluded c2, included c3, edited c1 → c4',
    })
    expect(count(db, 'messages')).toBe(6) // nothing is sent until the user acts
  })

  it('starts at the message itself when it is a user message', async () => {
    const { send } = await chat()
    const res = await send('POST', '/replays', { fromMessageId: 1, contextChanges: { cards: [{ cardId: 2, state: 'excluded' }] } })
    expect(res.body.pendingPrompts.map((p: Json) => p.messageId)).toEqual([1, 3, 5])
    expect(res.body.timeline).toMatchObject({ branchPointId: null, headMessageId: null, replayNextId: 1, replayMode: 'step' })
  })

  it('counts the calls of a dry run (doubled with derived rules) and creates nothing', async () => {
    const { send, db } = await chat()
    const cards = count(db, 'cards')
    const dry = await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes, mode: 'auto', dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body).toEqual({ timeline: null, pendingPrompts: [{ messageId: 3, content: 'q2' }, { messageId: 5, content: 'q3' }], estimatedApiCalls: 2 })
    expect((await send('POST', '/replays', { fromMessageId: 1, dryRun: true })).body.estimatedApiCalls).toBe(3)
    await send('PATCH', '/conversations/1', { showDerivedRules: true })
    expect((await send('POST', '/replays', { fromMessageId: 4, dryRun: true })).body.estimatedApiCalls).toBe(2)
    expect(count(db, 'timelines')).toBe(1)
    expect(count(db, 'cards')).toBe(cards)
    expect(count(db, 'timeline_context')).toBe(0)
    // a dry run still validates the changes
    expect((await send('POST', '/replays', { fromMessageId: 2, dryRun: true, contextChanges: { cards: [{ cardId: 99, state: 'included' }] } })).status).toBe(404)
  })

  it('refuses a replay without prompts and bad sources', async () => {
    const { send } = await chat()
    expect((await send('POST', '/replays', { fromMessageId: 6 })).status).toBe(400)
    expect((await send('POST', '/replays', { fromMessageId: 6, dryRun: true })).body).toMatchObject({ pendingPrompts: [], estimatedApiCalls: 0 })
    expect((await send('POST', '/replays', { fromMessageId: 99 })).body.error.code).toBe('message_not_found')
    expect((await send('POST', '/replays', { fromMessageId: 2, sourceTimelineId: 99 })).body.error.code).toBe('timeline_not_found')
    await send('POST', '/conversations/1/timelines', { fromMessageId: 2 })
    expect((await send('POST', '/replays', { fromMessageId: 3, sourceTimelineId: 2 })).status).toBe(400) // q2 is not on that timeline
    expect((await send('POST', '/replays', { fromMessageId: 2, mode: 'sometimes' })).status).toBe(400)
  })
})

describe('step-by-step replay', () => {
  it('sends, edits and skips prompts and finishes after the last one', async () => {
    const { send, stream, llm } = await chat()
    await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes })

    const first = await stream('/replays/2/next', { action: 'send' })
    expect(first.events.map((e) => e.event)).toEqual(['message_start', 'text_delta', 'message_stop'])
    expect(first.events[0].data).toMatchObject({ userMessageId: 7, assistantMessageId: 8, timelineId: 2 })
    expect(first.events[0].data.cards).toEqual([{ cardId: 4, version: 1, state: 'included' }, { cardId: 3, version: 1, state: 'included' }])
    expect(llm.requests[0].system).toContain('ALPHA EDITED')
    expect(llm.requests[0].messages.map((m) => m.content)).toEqual(['q1', 're: q1', 'q2'])
    let tl = (await send('GET', '/conversations/1/tree')).body.timelines[1]
    expect(tl).toMatchObject({ replayStatus: 'paused', replayNextId: 5, headMessageId: 8 })

    const second = await stream('/replays/2/next', { action: 'edit', content: 'q3 but better' })
    expect(second.events.at(-1)?.event).toBe('message_stop')
    expect(llm.requests[1].messages.map((m) => m.content)).toEqual(['q1', 're: q1', 'q2', 're: q2', 'q3 but better'])
    // the branch context is carried forward (fork stays in, c2 stays out)
    expect(llm.requests[1].system).toContain('ALPHA EDITED')
    expect(llm.requests[1].system).not.toContain('beta')

    tl = (await send('GET', '/conversations/1/tree')).body.timelines[1]
    expect(tl).toMatchObject({ replayStatus: 'finished', replayNextId: null, headMessageId: 10 })
    const messages = (await send('GET', '/timelines/2/messages')).body as Json[]
    expect(messages.map((m) => [m.id, m.role, m.replayOfId])).toEqual([[1, 'user', null], [2, 'assistant', null], [7, 'user', 3], [8, 'assistant', 4], [9, 'user', 5], [10, 'assistant', 6]])
    expect(messages[4].content).toBe('q3 but better')
    expect(messages[5].content).toBe('re: q3 but better')
    // one more action is not possible
    const again = await stream('/replays/2/next', { action: 'send' })
    expect([again.status, again.json.error.code]).toEqual([409, 'replay_not_active'])
  })

  it('skips without a call and keeps the branch context for the next prompt', async () => {
    const { send, stream, llm } = await chat()
    await send('POST', '/replays', { fromMessageId: 2, contextChanges: { cards: [{ cardId: 2, state: 'excluded' }], editedCards: [] } })
    const skipped = await stream('/replays/2/next', { action: 'skip' })
    expect(skipped.json.timeline).toMatchObject({ id: 2, replayStatus: 'paused', replayNextId: 5 })
    expect(llm.requests).toHaveLength(0)
    const sent = await stream('/replays/2/next', { action: 'send' })
    expect(sent.events[0].data.cards).toEqual([{ cardId: 1, version: 1, state: 'included' }])
    expect(llm.requests[0].messages.map((m) => m.content)).toEqual(['q1', 're: q1', 'q3'])
    expect(llm.requests[0].system).not.toContain('beta')
    const { replayStatus } = (await send('GET', '/conversations/1/tree')).body.timelines[1]
    expect(replayStatus).toBe('finished')
  })

  it('finishes when the last prompt is skipped and replays from the first user message', async () => {
    const { send, stream } = await chat()
    await send('POST', '/replays', { fromMessageId: 5 })
    expect((await stream('/replays/2/next', { action: 'skip' })).json.timeline).toMatchObject({ replayStatus: 'finished', replayNextId: null })

    await send('POST', '/replays', { fromMessageId: 1, contextChanges: { cards: [{ cardId: 2, state: 'excluded' }], editedCards: [] } })
    const res = await stream('/replays/3/next', { action: 'send' })
    expect(res.events[0].data).toMatchObject({ timelineId: 3 })
    const messages = (await send('GET', '/timelines/3/messages')).body as Json[]
    expect(messages.map((m) => [m.role, m.parentId, m.replayOfId])).toEqual([['user', null, 1], ['assistant', messages[0].id, 2]])
    expect(messages[0].context.map((c: Json) => [c.cardId, c.state])).toEqual([[1, 'included'], [2, 'excluded'], [3, 'excluded']])
  })

  it('validates the action and the replay state', async () => {
    const { send, stream } = await chat()
    await send('POST', '/replays', { fromMessageId: 2 })
    expect((await stream('/replays/2/next', { action: 'edit' })).status).toBe(400)
    expect((await stream('/replays/2/next', { action: 'jump' })).status).toBe(400)
    expect((await stream('/replays/99/next', { action: 'send' })).json.error.code).toBe('timeline_not_found')
    const main = await stream('/replays/1/next', { action: 'send' })
    expect([main.status, main.json.error.code]).toEqual([409, 'replay_not_active'])
    expect((await stream('/replays/1/auto')).json.error.code).toBe('replay_not_active')
    expect((await stream('/replays/1/branch-off')).json.error.code).toBe('replay_not_active')
    expect((await stream('/replays/1/cancel')).json.error.code).toBe('replay_not_active')
  })

  it('answers 424 without an API key and sends nothing', async () => {
    const { app, db } = createTestApp(null)
    const call = (method: string, path: string, body?: unknown) => app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    await call('POST', '/conversations', {})
    db.exec("INSERT INTO messages (conversation_id, role, content) VALUES (1, 'user', 'q'), (1, 'assistant', 'a')")
    db.exec("UPDATE messages SET parent_id = 1 WHERE id = 2; UPDATE timelines SET head_message_id = 2 WHERE id = 1")
    db.exec("INSERT INTO messages (conversation_id, parent_id, role, content) VALUES (1, 2, 'user', 'q2'), (1, 3, 'assistant', 'a2')")
    db.exec('UPDATE timelines SET head_message_id = 4 WHERE id = 1')
    const created = await call('POST', '/replays', { fromMessageId: 2 })
    expect(created.status).toBe(201)
    expect((await call('POST', '/replays/2/next', { action: 'send' })).status).toBe(424)
    expect((await call('POST', '/replays/2/auto')).status).toBe(424)
  })
})

describe('branching off and cancelling', () => {
  it('branches off: the remaining prompts are not sent and the timeline is ordinary', async () => {
    const { send, stream, llm } = await chat()
    await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes })
    await stream('/replays/2/next', { action: 'send' })
    // while the replay is active, free messages are refused
    const blocked = await stream('/timelines/2/messages', { content: 'free' })
    expect([blocked.status, blocked.json.error.code]).toEqual([409, 'replay_active'])

    const off = await send('POST', '/replays/2/branch-off')
    expect(off.status).toBe(200)
    expect(off.body).toMatchObject({ id: 2, replayStatus: 'branched_off', replayNextId: null })
    expect((await stream('/replays/2/next', { action: 'send' })).json.error.code).toBe('replay_not_active')
    expect((await send('POST', '/replays/2/branch-off')).body.error.code).toBe('replay_not_active')

    llm.requests.length = 0
    const free = await stream('/timelines/2/messages', { content: 'my own question' })
    expect(free.events.at(-1)?.event).toBe('message_stop')
    expect(llm.requests[0].messages.map((m) => m.content)).toEqual(['q1', 're: q1', 'q2', 're: q2', 'my own question'])
    expect(llm.requests[0].system).toContain('ALPHA EDITED')
    const messages = (await send('GET', '/timelines/2/messages')).body as Json[]
    expect(messages.at(-2)).toMatchObject({ role: 'user', replayOfId: null })
  })

  it('cancels a paused replay', async () => {
    const { send, stream } = await chat()
    await send('POST', '/replays', { fromMessageId: 2 })
    expect((await send('POST', '/replays/2/cancel')).body).toMatchObject({ replayStatus: 'cancelled' })
    expect((await stream('/replays/2/next', { action: 'send' })).json.error.code).toBe('replay_not_active')
    expect((await send('POST', '/replays/2/cancel')).body.error.code).toBe('replay_not_active')
  })
})

describe('automatic replay', () => {
  it('answers all remaining prompts with progress events and a final replay_finished', async () => {
    const { send, stream, llm } = await chat()
    await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes, mode: 'auto' })
    const res = await stream('/replays/2/auto')
    expect(res.status).toBe(200)
    expect(res.events.map((e) => e.event)).toEqual([
      'progress',
      'message_start', 'text_delta', 'message_stop',
      'progress',
      'message_start', 'text_delta', 'message_stop',
      'progress',
      'replay_finished',
    ])
    expect(res.events.filter((e) => e.event === 'progress').map((e) => e.data)).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }])
    expect(res.events.at(-1)?.data).toEqual({ timelineId: 2, status: 'finished', done: 2, total: 2 })
    expect(llm.requests.map(lastUser)).toEqual(['q2', 'q3'])
    expect(llm.requests[1].system).toContain('ALPHA EDITED')
    const tl = (await send('GET', '/conversations/1/tree')).body.timelines[1]
    expect(tl).toMatchObject({ replayStatus: 'finished', replayMode: 'auto', replayNextId: null })
    const messages = (await send('GET', '/timelines/2/messages')).body as Json[]
    expect(messages.map((m) => m.replayOfId)).toEqual([null, null, 3, 4, 5, 6])
    expect((await stream('/replays/2/auto')).json.error.code).toBe('replay_not_active')
  })

  it('continues an interrupted step replay and switches to auto', async () => {
    const { send, stream, llm } = await chat()
    await send('POST', '/replays', { fromMessageId: 2 })
    await stream('/replays/2/next', { action: 'send' })
    const res = await stream('/replays/2/auto')
    expect(res.events.filter((e) => e.event === 'progress').map((e) => e.data)).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }])
    expect(llm.requests.map(lastUser)).toEqual(['q2', 'q3'])
    expect((await send('GET', '/conversations/1/tree')).body.timelines[1]).toMatchObject({ replayStatus: 'finished', replayMode: 'auto' })
  })

  it('is cancelled by the stop endpoint during an answer', async () => {
    let armed = false
    const reply = async function* (request: LlmRequest, signal: AbortSignal) {
      yield `re: ${lastUser(request)}`
      // the second replayed answer hangs until it is stopped
      if (armed && lastUser(request) === 'q3' && !signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve))
    }
    const { send, request, db } = await chat(reply)
    armed = true
    await send('POST', '/replays', { fromMessageId: 2, mode: 'auto' })
    const res = await request('POST', '/replays/2/auto')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    // wait until the second answer has started streaming (its message_start arrives after the first progress)
    while ((seen.match(/event: message_start/g) ?? []).length < 2 || !seen.includes('re: q3')) {
      const r = await reader.read()
      if (r.done) throw new Error(`stream ended early: ${seen}`)
      seen += decoder.decode(r.value)
    }
    const streaming = db.prepare("SELECT id FROM messages WHERE status = 'streaming'").get() as { id: number }
    expect((await send('POST', `/messages/${streaming.id}/stop`)).status).toBe(204)
    for (let r = await reader.read(); !r.done; r = await reader.read()) seen += decoder.decode(r.value)
    const events = parseSse(seen)
    expect(events.at(-1)).toEqual({ event: 'replay_finished', data: { timelineId: 2, status: 'cancelled', done: 1, total: 2 } })
    expect(seen).not.toContain('event: error')
    expect(events.filter((e) => e.event === 'message_stop')).toHaveLength(1)
    const tl = (await send('GET', '/conversations/1/tree')).body.timelines[1]
    expect(tl).toMatchObject({ replayStatus: 'cancelled' })
    expect((await send('GET', '/timelines/2/messages')).body.at(-1)).toMatchObject({ status: 'stopped' })
    expect((await send('POST', '/replays/2/auto')).body.error.code).toBe('replay_not_active')
  })

  it('is cancelled when the client closes the stream', async () => {
    let armed = false
    const reply = async function* (request: LlmRequest, signal: AbortSignal) {
      yield `re: ${lastUser(request)}`
      if (armed && lastUser(request) === 'q3' && !signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve))
    }
    const { send, request, db } = await chat(reply)
    armed = true
    await send('POST', '/replays', { fromMessageId: 2, mode: 'auto' })
    const res = await request('POST', '/replays/2/auto')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('re: q3')) seen += decoder.decode((await reader.read()).value)
    await reader.cancel()
    for (let i = 0; i < 100 && (db.prepare("SELECT 1 FROM messages WHERE status = 'streaming'").get() !== undefined); i++) await new Promise((r) => setTimeout(r, 10))
    for (let i = 0; i < 100 && (await send('GET', '/conversations/1/tree')).body.timelines[1].replayStatus === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
    expect((await send('GET', '/conversations/1/tree')).body.timelines[1].replayStatus).toBe('cancelled')
    expect(db.prepare("SELECT status FROM messages WHERE id = 10").get()).toEqual({ status: 'stopped' })
  })

  it('pauses on an error so the rest can be continued step by step', async () => {
    let armed = false
    const reply = async function* (request: LlmRequest) {
      if (armed && lastUser(request) === 'q3') throw new Error('boom')
      yield `re: ${lastUser(request)}`
    }
    const { send, stream, db } = await chat(reply)
    armed = true
    await send('POST', '/replays', { fromMessageId: 2, mode: 'auto' })
    const res = await stream('/replays/2/auto')
    expect(res.events.map((e) => e.event).slice(-3)).toEqual(['message_start', 'error', 'replay_finished'])
    expect(res.events.at(-1)?.data).toMatchObject({ status: 'paused', done: 1, total: 2 })
    expect(db.prepare('SELECT replay_status, replay_next_id FROM timelines WHERE id = 2').get()).toMatchObject({ replay_status: 'paused', replay_next_id: null })
  })

  it('treats a running replay without a live stream (after a restart) as paused', async () => {
    const { send, stream, db } = await chat()
    await send('POST', '/replays', { fromMessageId: 2 })
    db.exec("UPDATE timelines SET replay_status = 'running' WHERE id = 2")
    expect((await stream('/replays/2/next', { action: 'send' })).status).toBe(200)
  })
})

describe('tree and compare', () => {
  it('provides what the branch view needs', async () => {
    const { send, stream } = await chat()
    await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes })
    await stream('/replays/2/next', { action: 'send' })
    const tree = (await send('GET', '/conversations/1/tree')).body
    expect(tree.timelines[0]).toMatchObject({ id: 1, name: 'main', parentTimelineId: null, branchPointId: null, changeSummary: null, replayStatus: null })
    expect(tree.timelines[1]).toMatchObject({
      id: 2,
      parentTimelineId: 1,
      branchPointId: 2,
      changeSummary: 'excluded c2, included c3, edited c1 → c4',
      replayStatus: 'paused',
      replayMode: 'step',
      replaySourceId: 1,
      replayNextId: 5,
    })
    expect(tree.messages.map((m: Json) => [m.id, m.parentId, m.role, m.replayOfId, m.timelineIds])).toEqual([
      [1, null, 'user', null, [1, 2]],
      [2, 1, 'assistant', null, [1, 2]],
      [3, 2, 'user', null, [1]],
      [4, 3, 'assistant', null, [1]],
      [5, 4, 'user', null, [1]],
      [6, 5, 'assistant', null, [1]],
      [7, 2, 'user', 3, [2]],
      [8, 7, 'assistant', 4, [2]],
    ])
    expect(tree.messages[0]).toMatchObject({ excerpt: 'q1', status: 'complete' })
    expect(tree.messages[7].excerpt).toBe('re: q2')
  })

  it('compares two timelines from the common branch point, paired by what was replayed', async () => {
    const { send, stream } = await chat()
    await send('POST', '/replays', { fromMessageId: 2, contextChanges: changes, mode: 'auto' })
    await stream('/replays/2/next', { action: 'send' })
    await stream('/replays/2/next', { action: 'skip' })
    const cmp = (await send('GET', '/timelines/1/compare/2')).body
    expect(cmp.commonBranchPointId).toBe(2)
    expect(cmp.a.messages.map((m: Json) => m.id)).toEqual([3, 4, 5, 6])
    expect(cmp.b.messages.map((m: Json) => m.id)).toEqual([7, 8])
    expect(cmp.pairs.map((p: Json) => [p.a?.id ?? null, p.b?.id ?? null])).toEqual([[3, 7], [4, 8], [5, null], [6, null]])
    expect(cmp.a.timeline.id).toBe(1)
    // symmetric, and a timeline against itself has nothing to show
    const back = (await send('GET', '/timelines/2/compare/1')).body
    expect(back.pairs.map((p: Json) => [p.a?.id ?? null, p.b?.id ?? null])).toEqual([[7, 3], [8, 4], [null, 5], [null, 6]])
    expect((await send('GET', '/timelines/1/compare/1')).body).toMatchObject({ commonBranchPointId: 6, pairs: [] })
  })

  it('compares timelines that have no replay link in order and from the start', async () => {
    const { send, stream } = await chat()
    await send('POST', '/conversations/1/timelines', { fromMessageId: 1, contextChanges: { cards: [{ cardId: 2, state: 'excluded' }], editedCards: [] } })
    await stream('/timelines/2/messages', { content: 'other' })
    const cmp = (await send('GET', '/timelines/1/compare/2')).body
    expect(cmp.commonBranchPointId).toBeNull()
    expect(cmp.pairs.map((p: Json) => [p.a?.id ?? null, p.b?.id ?? null])).toEqual([[1, null], [2, null], [3, null], [4, null], [5, null], [6, null], [null, 7], [null, 8]])
  })

  it('rejects unknown timelines and timelines of different conversations', async () => {
    const { send } = await chat()
    await send('POST', '/conversations', {})
    expect((await send('GET', '/timelines/1/compare/99')).body.error.code).toBe('timeline_not_found')
    expect((await send('GET', '/timelines/1/compare/2')).status).toBe(400)
  })
})
