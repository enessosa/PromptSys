import { describe, expect, it } from 'vitest'
import { createStubLlm, createTestApp, type StubReply } from '../testing.ts'

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper: shapes are checked by the assertions

/** The first reply is the chat answer, the second the tool output of the rules call. */
async function setup(tool: StubReply, ...more: StubReply[]) {
  const llm = createStubLlm('Fields are required [c1]', tool, ...more)
  const { app, db } = createTestApp(llm)
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: (text && !text.startsWith('event:') ? JSON.parse(text) : undefined) as Json }
  }
  await send('POST', '/cards', { title: 'Field rules', body: 'Fields are required unless marked optional.' })
  await send('POST', '/cards', { title: 'Other', body: 'Other.' })
  await send('POST', '/conversations', {})
  await send('POST', '/timelines/1/messages', { content: 'Are fields required?', cards: [{ cardId: 1, state: 'included' }] })
  return { send, db, llm }
}

const GOOD = {
  toolInput: {
    rules: [
      { text: 'Fields are required unless marked optional.', source: { kind: 'card', cardId: 1 } },
      { text: 'JSON has no comments.', source: { kind: 'prior_knowledge' } },
    ],
  },
}

describe('extract rules', () => {
  it('stores the rules from the tool call, labelled as claimed', async () => {
    const { send, llm } = await setup(GOOD)
    const res = await send('POST', '/messages/2/rules')
    expect(res.status).toBe(200)
    expect(res.body.warning).toBeUndefined()
    expect(res.body.rules).toMatchObject([
      { id: 1, conversationId: 1, messageId: 2, status: 'proposed', source: { kind: 'card', cardId: 1, reliability: 'claimed' }, cardId: null },
      { id: 2, status: 'proposed', source: { kind: 'prior_knowledge', cardId: null, reliability: 'claimed' } },
    ])
    // the call is a forced tool call whose input holds the answer and the sent cards
    const request = llm.requests[1] as Json
    expect(request.tool.name).toBe('report_rules')
    expect(request.messages[0].content).toContain('Fields are required [c1]')
    expect(request.messages[0].content).toContain('id="c1"')
    expect(request.messages[0].content).not.toContain('Other.')
    expect((await send('GET', '/conversations/1/rules')).body).toHaveLength(2)
  })

  it('accepts "c1" as card id, skips unusable entries with a warning', async () => {
    const { send } = await setup({
      toolInput: {
        rules: [
          { text: 'A', source: { kind: 'card', cardId: 'c1' } },
          { text: 'B', source: { kind: 'card', cardId: 2 } }, // card 2 was not sent
          { text: 'C', source: { kind: 'card' } }, // no card id
          { text: '', source: { kind: 'prior_knowledge' } }, // empty text
          'junk',
        ],
      },
    })
    const res = await send('POST', '/messages/2/rules')
    expect(res.body.rules.map((r: Json) => r.text)).toEqual(['A'])
    expect(res.body.warning).toMatch(/4 entries/)
  })

  it.each([
    ['malformed tool output', { toolInput: 'rules: none' }],
    ['rules is not a list', { toolInput: { rules: 'many' } }],
    ['no tool call', 'plain text'],
  ] as const)('gives an empty list and a warning for %s', async (_name, reply) => {
    const { send } = await setup(reply)
    const res = await send('POST', '/messages/2/rules')
    expect(res.status).toBe(200)
    expect(res.body.rules).toEqual([])
    expect(typeof res.body.warning).toBe('string')
  })

  it('replaces undecided rules on a second run but keeps decided ones', async () => {
    const { send } = await setup(GOOD, { toolInput: { rules: [{ text: 'New rule', source: { kind: 'prior_knowledge' } }] } })
    await send('POST', '/messages/2/rules')
    await send('PATCH', '/rules/1', { status: 'confirmed' })
    await send('POST', '/messages/2/rules')
    const rules = (await send('GET', '/conversations/1/rules')).body
    expect(rules.map((r: Json) => [r.text, r.status])).toEqual([
      ['Fields are required unless marked optional.', 'confirmed'],
      ['New rule', 'proposed'],
    ])
  })

  it('rejects user messages (400) and unknown messages (404), and needs an API key (424)', async () => {
    const { send } = await setup(GOOD)
    expect((await send('POST', '/messages/1/rules')).status).toBe(400)
    expect((await send('POST', '/messages/99/rules')).status).toBe(404)
    const noKey = createTestApp(null)
    const res = await noKey.app.request('/api/messages/1/rules', { method: 'POST' })
    expect(res.status).toBe(424)
  })
})

describe('confirm, reject, correct', () => {
  it('confirms and rejects; rejected rules are hidden from the list unless asked for', async () => {
    const { send } = await setup(GOOD)
    await send('POST', '/messages/2/rules')
    expect((await send('PATCH', '/rules/1', { status: 'confirmed' })).body.rule.status).toBe('confirmed')
    expect((await send('PATCH', '/rules/2', { status: 'rejected' })).body.rule.status).toBe('rejected')
    expect((await send('GET', '/conversations/1/rules')).body).toHaveLength(1)
    expect((await send('GET', '/conversations/1/rules?includeRejected=true')).body).toHaveLength(2)
    expect((await send('GET', '/conversations/9/rules')).status).toBe(404)
  })

  it('correcting creates an included rule card linked to the source card', async () => {
    const { send } = await setup(GOOD)
    await send('POST', '/messages/2/rules')
    const res = await send('PATCH', '/rules/1', { status: 'corrected', text: 'Fields are optional unless marked required.' })
    expect(res.status).toBe(200)
    expect(res.body.rule).toMatchObject({ status: 'corrected', cardId: res.body.card.id })
    expect(res.body.card).toMatchObject({ kind: 'rule', defaultIncluded: true, body: 'Fields are optional unless marked required.', title: 'Fields are optional unless marked required.', version: 1 })
    expect(res.body.card.links).toMatchObject([{ sourceId: res.body.card.id, targetId: 1, kind: 'derived_from' }])
    // fed back: a new conversation starts with the rule card
    const preview = await send('POST', '/conversations', {})
    expect(preview.status).toBe(201)
    expect((await send('PATCH', '/rules/1', { status: 'confirmed' })).status).toBe(400) // already corrected
  })

  it('correcting a prior-knowledge rule creates a card without a link; text is required', async () => {
    const { send } = await setup(GOOD)
    await send('POST', '/messages/2/rules')
    expect((await send('PATCH', '/rules/2', { status: 'corrected' })).status).toBe(400)
    expect((await send('PATCH', '/rules/2', { status: 'corrected', text: '  ' })).status).toBe(400)
    const res = await send('PATCH', '/rules/2', { status: 'corrected', text: 'JSON has no comments, JSON5 does.' })
    expect(res.body.card.links).toEqual([])
    expect((await send('PATCH', '/rules/99', { status: 'confirmed' })).status).toBe(404)
    expect((await send('PATCH', '/rules/1', { status: 'proposed' })).status).toBe(400)
  })
})

describe('save as card', () => {
  it('turns a confirmed rule into a rule card on demand and keeps the status confirmed', async () => {
    const { send } = await setup(GOOD)
    await send('POST', '/messages/2/rules')
    expect((await send('POST', '/rules/1/card')).status).toBe(400) // still proposed
    await send('PATCH', '/rules/1', { status: 'confirmed' })
    const res = await send('POST', '/rules/1/card')
    expect(res.status).toBe(201)
    expect(res.body.rule).toMatchObject({ status: 'confirmed', cardId: res.body.card.id })
    expect(res.body.card).toMatchObject({ kind: 'rule', defaultIncluded: true })
    expect((await send('POST', '/rules/1/card')).status).toBe(400) // only once
  })
})
