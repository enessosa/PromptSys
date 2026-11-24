import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../db/index.ts'
import { createTestApp } from '../testing.ts'
import { createFakeRunner } from './fake.ts'
import type { AgentRunner } from './runner.ts'
import { cardFolder, cardRoot, resetStaleSessions } from './service.ts'

const projectDir = () => mkdtempSync(join(tmpdir(), 'promptsys-project-'))

function setup(runner?: AgentRunner) {
  const { app, db } = createTestApp(undefined, undefined, runner)
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: the response shape is checked by the assertions
    const json: any = text ? JSON.parse(text) : undefined
    return { status: res.status, body: json }
  }
  const codeMode = () => send('PUT', '/settings', { mode: 'claude_code' })
  const session = async (path = projectDir(), title?: string) => (await send('POST', '/code/sessions', { projectPath: path, title })).body
  const waitFor = async (id: number, status: string) => {
    for (let i = 0; i < 200; i++) {
      const s = (await send('GET', `/code/sessions/${id}`)).body
      if (s.session.status === status) return s
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`session ${id} never reached ${status}`)
  }
  const events = async (id: number) => (await send('GET', `/code/sessions/${id}`)).body.events as { seq: number; type: string; payload: Record<string, unknown> }[]
  return { app, db, send, codeMode, session, waitFor, events }
}

describe('migration 0005', () => {
  it('upgrades an existing database and keeps its cards', () => {
    const db = openDatabase(':memory:')
    // Apply everything, then pretend the new migration is still missing on a db that has cards already.
    migrate(db)
    db.exec("INSERT INTO cards (title, body, kind) VALUES ('old', '', 'note')")
    db.exec('DROP INDEX idx_cards_code_session; ALTER TABLE cards DROP COLUMN code_session_id; ALTER TABLE cards DROP COLUMN origin; ALTER TABLE cards DROP COLUMN review_status')
    db.exec('DROP TABLE code_events; DROP TABLE code_sessions; DELETE FROM schema_migrations WHERE version >= 5')
    expect(migrate(db)).toEqual(['0005_code_mode.sql', '0006_code_permission_mode.sql'])
    expect(db.prepare('SELECT title, origin, review_status, code_session_id FROM cards').all()).toEqual([
      { title: 'old', origin: null, review_status: null, code_session_id: null },
    ])
    db.exec("INSERT INTO code_sessions (title, project_path) VALUES ('s', '/x')")
    expect(() => db.exec("UPDATE cards SET review_status = 'bogus'")).toThrow()
  })
})

describe('settings and gating', () => {
  it('has mode api and codeAuth local_login by default and validates them', async () => {
    const { send } = setup()
    expect((await send('GET', '/settings')).body).toMatchObject({ mode: 'api', codeAuth: 'local_login' })
    expect((await send('PUT', '/settings', { mode: 'other' })).status).toBe(400)
    expect((await send('PUT', '/settings', { mode: 'claude_code', codeAuth: 'api_key' })).body).toMatchObject({ mode: 'claude_code', codeAuth: 'api_key' })
  })

  it('answers /code/status in both modes, the other code routes only in claude_code mode', async () => {
    const { send, codeMode } = setup()
    expect((await send('GET', '/code/status')).body).toEqual({ available: true, mode: 'api', codeAuth: 'local_login' })
    for (const [method, path] of [['GET', '/code/sessions'], ['POST', '/code/sessions'], ['GET', '/code/sessions/1'], ['PATCH', '/code/cards/1']]) {
      const res = await send(method, path, method === 'GET' ? undefined : {})
      expect(res.status, path).toBe(409)
      expect(res.body.error.code).toBe('feature_requires_claude_code_mode')
    }
    await codeMode()
    expect((await send('GET', '/code/sessions')).status).toBe(200)
    expect((await send('GET', '/code/status')).body.mode).toBe('claude_code')
  })

  it('locks ablation and auto replay in claude_code mode, but not the step-by-step replay', async () => {
    const { send, codeMode } = setup()
    const card = (await send('POST', '/cards', { title: 'x' })).body
    await codeMode()
    for (const [method, path, body] of [
      ['POST', '/messages/1/ablations', { cardIds: [card.id] }],
      ['POST', '/replays', { fromMessageId: 1, mode: 'auto' }],
      ['POST', '/replays/1/auto', {}],
    ] as const) {
      const res = await send(method, path, body)
      expect(res.status, path).toBe(409)
      expect(res.body.error.code).toBe('feature_requires_api_mode')
    }
    // Step replay and dry-run ablation are not locked: they fail later for other reasons (no such message).
    expect((await send('POST', '/replays', { fromMessageId: 1, mode: 'step' })).body.error.code).toBe('message_not_found')
    expect((await send('POST', '/messages/1/ablations', { cardIds: [card.id], dryRun: true })).body.error.code).not.toBe('feature_requires_api_mode')
  })

  it('does not lock anything in api mode', async () => {
    const { send } = setup()
    expect((await send('POST', '/replays', { fromMessageId: 1, mode: 'auto' })).body.error.code).toBe('message_not_found')
  })
})

describe('sessions', () => {
  it('creates, lists, renames and deletes sessions; the title defaults to the folder name', async () => {
    const { send, codeMode } = setup()
    await codeMode()
    const dir = projectDir()
    const created = await send('POST', '/code/sessions', { projectPath: dir })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ id: 1, projectPath: dir, status: 'idle', title: dir.split('/').pop() })
    expect((await send('GET', '/code/sessions')).body).toHaveLength(1)
    expect((await send('PATCH', '/code/sessions/1', { title: 'Renamed' })).body.title).toBe('Renamed')
    expect((await send('GET', '/code/sessions/1')).body).toMatchObject({ slashCommands: ['save', 'plantuml'], events: [] })
    expect((await send('DELETE', '/code/sessions/1')).status).toBe(204)
    expect((await send('GET', '/code/sessions/1')).body.error.code).toBe('session_not_found')
  })

  it('rejects relative and missing project paths with 422 invalid_project_path', async () => {
    const { send, codeMode } = setup()
    await codeMode()
    for (const projectPath of ['relative/dir', '/definitely/not/here', '/etc/hosts']) {
      const res = await send('POST', '/code/sessions', { projectPath })
      expect(res.status, projectPath).toBe(422)
      expect(res.body.error.code).toBe('invalid_project_path')
    }
  })
})

describe('turns with the fake agent', () => {
  it('persists the events of a message with increasing seq and records a linked-able card', async () => {
    const { send, codeMode, session, waitFor, events } = setup()
    await codeMode()
    const s = await session()
    const res = await send('POST', `/code/sessions/${s.id}/messages`, { text: 'explain the build' })
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ accepted: true })
    const done = await waitFor(s.id, 'idle')
    expect(done.slashCommands).toEqual(['save', 'plantuml'])
    const list = await events(s.id)
    expect(list.map((e) => e.seq)).toEqual(list.map((_, i) => i + 1))
    expect(list.map((e) => e.type)).toEqual(['user', 'status', 'init', 'text', 'card', 'result', 'context', 'usage', 'plan_usage', 'status'])
    expect(list[3].payload.text).toBe('Working on: explain the build')
    const cards = (await send('GET', `/code/sessions/${s.id}/cards`)).body
    expect(cards).toEqual([expect.objectContaining({ title: 'Understanding: explain the build', reviewStatus: 'proposed', version: 1 })])
    const card = (await send('GET', `/cards/${cards[0].id}`)).body
    expect(card).toMatchObject({ origin: 'agent', reviewStatus: 'proposed', kind: 'note', folderPath: cardRoot(s.projectPath) })
  })

  it('reports the plan limits once for all sessions, newest first', async () => {
    const { send, codeMode, session, waitFor } = setup()
    await codeMode()
    expect((await send('GET', '/code/plan-usage')).body).toBeNull()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'hello' })
    await waitFor(s.id, 'idle')
    const usage = (await send('GET', '/code/plan-usage')).body
    expect(usage).toMatchObject({ fiveHour: { utilization: expect.any(Number) }, observedAt: expect.any(String) })
  })

  it('persists subagent events with their parentToolUseId', async () => {
    const { send, codeMode, session, waitFor, events } = setup()
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'use an agent' })
    await waitFor(s.id, 'idle')
    const list = await events(s.id)
    const inner = list.filter((e) => e.payload.parentToolUseId === 'fake-agent-1')
    expect(inner.map((e) => e.type)).toEqual(['text', 'tool_call', 'tool_result'])
    expect(list.find((e) => e.type === 'tool_call' && e.payload.name === 'Agent')?.payload.parentToolUseId).toBeUndefined()
  })

  it('keeps agent cards out of the library until the user accepts them, and lists only open ones for review', async () => {
    const { send, codeMode, session, waitFor } = setup()
    await codeMode()
    const user = (await send('POST', '/cards', { title: 'mine' })).body
    expect(user).toMatchObject({ origin: null, reviewStatus: null })
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'hello' })
    await waitFor(s.id, 'idle')
    // Proposed: only in the review list of the session.
    expect((await send('GET', '/cards')).body.map((c: { origin: string | null }) => c.origin)).toEqual([null])
    expect((await send('GET', '/graph')).body.nodes).toHaveLength(1)
    const [proposed] = (await send('GET', `/code/sessions/${s.id}/cards`)).body
    expect(proposed).toMatchObject({ reviewStatus: 'proposed' })
    // Confirmed: joins the library and the graph, leaves the review list.
    await send('PATCH', `/code/cards/${proposed.id}`, { reviewStatus: 'confirmed' })
    expect((await send('GET', '/cards')).body.map((c: { origin: string | null }) => c.origin)).toEqual([null, 'agent'])
    expect((await send('GET', '/graph')).body.nodes.map((n: { reviewStatus: string | null }) => n.reviewStatus)).toEqual([null, 'confirmed'])
    expect((await send('GET', `/code/sessions/${s.id}/cards`)).body).toEqual([])
  })

  it('replays a tool call after an allowed approval and writes nothing for a denied one', async () => {
    const { send, codeMode, session, waitFor, events } = setup()
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'please edit it' })
    const waiting = await waitFor(s.id, 'waiting_approval')
    const request = waiting.events.find((e: { type: string }) => e.type === 'approval_request')
    expect(request.payload).toMatchObject({ toolName: 'Edit', input: { file_path: 'README.md' } })
    expect((await send('POST', `/code/sessions/${s.id}/approvals/${request.payload.approvalId}`, { allow: true })).status).toBe(204)
    await waitFor(s.id, 'idle')
    expect((await events(s.id)).map((e) => e.type)).toContain('tool_result')
    expect((await send('POST', `/code/sessions/${s.id}/approvals/${request.payload.approvalId}`, { allow: true })).body.error.code).toBe('approval_not_found')

    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'edit again' })
    const second = await waitFor(s.id, 'waiting_approval')
    const again = second.events.filter((e: { type: string }) => e.type === 'approval_request').at(-1)
    await send('POST', `/code/sessions/${s.id}/approvals/${again.payload.approvalId}`, { allow: false, message: 'no' })
    await waitFor(s.id, 'idle')
    const all = await events(s.id)
    expect(all.filter((e) => e.type === 'tool_call')).toHaveLength(1)
    expect(all.some((e) => e.type === 'text' && e.payload.text === 'Edit was denied')).toBe(true)
    expect(all.filter((e) => e.type === 'approval_resolved').map((e) => e.payload.allow)).toEqual([true, false])
  })

  it('stops a turn that waits for approval and denies the open approval', async () => {
    const { send, codeMode, session, waitFor, events } = setup()
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'edit' })
    await waitFor(s.id, 'waiting_approval')
    expect((await send('POST', `/code/sessions/${s.id}/stop`)).status).toBe(204)
    const done = await waitFor(s.id, 'stopped')
    const resolved = done.events.find((e: { type: string }) => e.type === 'approval_resolved')
    expect(resolved.payload.allow).toBe(false)
    expect((await events(s.id)).some((e) => e.type === 'tool_call')).toBe(false)
    // A stopped session accepts the next message.
    expect((await send('POST', `/code/sessions/${s.id}/messages`, { text: 'again' })).status).toBe(202)
  })

  it('answers 409 session_busy while a turn runs, and runs sessions in parallel', async () => {
    const { send, codeMode, session, waitFor } = setup()
    await codeMode()
    const a = await session()
    const b = await session()
    await send('POST', `/code/sessions/${a.id}/messages`, { text: 'edit a' })
    await waitFor(a.id, 'waiting_approval')
    const busy = await send('POST', `/code/sessions/${a.id}/messages`, { text: 'second' })
    expect(busy.status).toBe(409)
    expect(busy.body.error.code).toBe('session_busy')
    // Session b is not blocked by a.
    await send('POST', `/code/sessions/${b.id}/messages`, { text: 'edit b' })
    await waitFor(b.id, 'waiting_approval')
    const approvalOf = async (id: number) => (await send('GET', `/code/sessions/${id}`)).body.events.find((e: { type: string }) => e.type === 'approval_request').payload.approvalId
    await send('POST', `/code/sessions/${a.id}/approvals/${await approvalOf(a.id)}`, { allow: true })
    await send('POST', `/code/sessions/${b.id}/approvals/${await approvalOf(b.id)}`, { allow: true })
    await waitFor(a.id, 'idle')
    await waitFor(b.id, 'idle')
    expect((await send('GET', `/code/sessions/${a.id}/cards`)).body).toHaveLength(1)
    expect((await send('GET', `/code/sessions/${b.id}/cards`)).body).toHaveLength(1)
  })

  it('streams events over SSE', async () => {
    const { app, send, codeMode, session } = setup()
    await codeMode()
    const s = await session()
    const res = await app.request(`/api/code/sessions/${s.id}/stream`)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'stream me' })
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('event: result')) {
      const { value, done } = await reader.read()
      if (done) break
      seen += decoder.decode(value)
    }
    await reader.cancel()
    expect(seen).toContain('event: user')
    expect(seen).toMatch(/event: text\ndata: \{"seq":\d+,"text":"Working on: stream me"\}/)
    expect(seen).toMatch(/event: card\ndata: \{"seq":\d+,"cardId":1,"action":"created"\}/)
  })

  it('stops a running turn when the session is deleted', async () => {
    const { send, codeMode, session, waitFor, db } = setup()
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'edit' })
    await waitFor(s.id, 'waiting_approval')
    expect((await send('DELETE', `/code/sessions/${s.id}`)).status).toBe(204)
    expect(db.prepare('SELECT COUNT(*) AS n FROM code_events').get()).toEqual({ n: 0 })
    // The card it recorded stays, without a session.
    expect(db.prepare('SELECT code_session_id FROM cards').get()).toEqual({ code_session_id: null })
  })

  it('reports a failing runner as an error event and status', async () => {
    const failing: AgentRunner = {
      available: async () => ({ ok: false, reason: 'no cli' }),
      // eslint-disable-next-line require-yield -- the generator only throws
      async *runTurn() {
        throw new Error('spawn failed')
      },
    }
    const { send, codeMode, session, waitFor, events } = setup(failing)
    expect((await send('GET', '/code/status')).body).toMatchObject({ available: false, reason: 'no cli' })
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'hi' })
    await waitFor(s.id, 'error')
    expect((await events(s.id)).find((e) => e.type === 'error')?.payload.message).toBe('spawn failed')
  })
})

describe('card review and binding', () => {
  async function withCard(setupResult = setup()) {
    await setupResult.codeMode()
    const dir = projectDir()
    const s = await setupResult.session(dir)
    await setupResult.send('POST', `/code/sessions/${s.id}/messages`, { text: 'first task' })
    await setupResult.waitFor(s.id, 'idle')
    const [card] = (await setupResult.send('GET', `/code/sessions/${s.id}/cards`)).body
    return { ...setupResult, s, dir, card }
  }

  it('confirms, corrects (new version) and rejects a card; user cards are not reviewable', async () => {
    const { send, card } = await withCard()
    expect((await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'confirmed' })).body).toMatchObject({ reviewStatus: 'confirmed', version: 1 })
    const corrected = (await send('PATCH', `/code/cards/${card.id}`, { title: 'Better title', body: 'Better body' })).body
    expect(corrected).toMatchObject({ reviewStatus: 'corrected', version: 2, title: 'Better title', body: 'Better body' })
    expect((await send('GET', `/cards/${card.id}/versions`)).body).toHaveLength(2)
    expect((await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'rejected' })).body.reviewStatus).toBe('rejected')
    const user = (await send('POST', '/cards', { title: 'mine' })).body
    expect((await send('PATCH', `/code/cards/${user.id}`, { reviewStatus: 'confirmed' })).body.error.code).toBe('card_not_found')
    expect((await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'proposed' })).status).toBe(400)
    expect((await send('PATCH', `/code/cards/${card.id}`, {})).status).toBe(400)
  })

  it('never records a rejected term again and reuses an existing card instead of a duplicate', async () => {
    const prompts: string[] = []
    const base = createFakeRunner()
    const spy: AgentRunner = { available: base.available, runTurn: (input) => (prompts.push(input.prompt), base.runTurn(input)) }
    const { send, s, card, waitFor } = await withCard(setup(spy))
    // Same task again: the fake records the same title, which is reused.
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'first task' })
    await waitFor(s.id, 'idle')
    expect((await send('GET', `/code/sessions/${s.id}/cards`)).body).toHaveLength(1)

    await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'rejected' })
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'first task' })
    await waitFor(s.id, 'idle')
    expect(prompts[2]).toBe(`<promptsys-cards>\nRejected by the user, do not record again: ${card.title}\n</promptsys-cards>\n\nfirst task`)
    // Nothing new to review; the rejected card stays out of the list but is kept (it blocks the term).
    expect((await send('GET', `/code/sessions/${s.id}/cards`)).body).toEqual([])
    expect((await send('GET', `/cards/${card.id}`)).body).toMatchObject({ reviewStatus: 'rejected' })
  })

  it('prepends only confirmed and corrected cards of the same project to the prompt', async () => {
    const prompts: string[] = []
    const base = createFakeRunner()
    const spy: AgentRunner = { available: base.available, runTurn: (input) => (prompts.push(input.prompt), base.runTurn(input)) }
    const ctx = await withCard(setup(spy))
    const { send, s, dir, card, waitFor } = ctx
    // Proposed: nothing injected yet.
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'second task' })
    await waitFor(s.id, 'idle')
    expect(prompts[1]).toBe('second task')

    await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'confirmed' })
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'third task' })
    await waitFor(s.id, 'idle')
    expect(prompts[2]).toBe(`<promptsys-cards>\n[c${card.id}] ${card.title}: ${card.body}\n</promptsys-cards>\n\nthird task`)

    // Slash commands stay first: no injection.
    await send('POST', `/code/sessions/${s.id}/messages`, { text: '/save now' })
    await waitFor(s.id, 'idle')
    expect(prompts[3]).toBe('/save now')

    // The event log keeps what the user typed, not the card block.
    const events = (await send('GET', `/code/sessions/${s.id}`)).body.events.filter((e: { type: string }) => e.type === 'user')
    expect(events.map((e: { payload: { text: string } }) => e.payload.text)).toEqual(['first task', 'second task', 'third task', '/save now'])

    // A corrected card is injected with its new text; a rejected one only by its title, so the agent does not record it again.
    await send('PATCH', `/code/cards/${card.id}`, { body: 'Corrected body' })
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'fourth' })
    await waitFor(s.id, 'idle')
    expect(prompts[4]).toContain(`[c${card.id}] ${card.title}: Corrected body`)
    await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'rejected' })
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'fifth' })
    await waitFor(s.id, 'idle')
    expect(prompts[5]).toBe(`<promptsys-cards>\nRejected by the user, do not record again: ${card.title}\n</promptsys-cards>\n\nfifth`)

    // Another project path gets nothing.
    await send('PATCH', `/code/cards/${card.id}`, { reviewStatus: 'confirmed' })
    const other = await ctx.session(projectDir())
    await send('POST', `/code/sessions/${other.id}/messages`, { text: 'other project' })
    await waitFor(other.id, 'idle')
    expect(prompts[6]).toBe('other project')
    expect(dir).not.toBe('')
  })
})

describe('card tools', () => {
  it('links a new card to existing cards, skips unknown targets and emits linked events', async () => {
    const runner: AgentRunner = {
      available: async () => ({ ok: true }),
      async *runTurn({ cardTools }) {
        const first = await cardTools.recordCard({ title: 'A', body: 'a' })
        const second = await cardTools.recordCard({ title: 'B', body: 'b', linkTo: [{ cardId: first, kind: 'derived_from', label: 'because' }, { cardId: 999 }] })
        await cardTools.linkCards({ sourceId: first, targetId: second, kind: 'contradicts' })
        yield { type: 'result', isError: false }
      },
    }
    const { send, codeMode, session, waitFor, events } = setup(runner)
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'go' })
    await waitFor(s.id, 'idle')
    const card = (await send('GET', '/cards/2')).body
    expect(card.links).toEqual([expect.objectContaining({ sourceId: 2, targetId: 1, kind: 'derived_from', label: 'because' })])
    expect((await events(s.id)).filter((e) => e.type === 'card').map((e) => [e.payload.cardId, e.payload.action])).toEqual([
      [1, 'created'],
      [2, 'created'],
      [1, 'linked'],
      [2, 'linked'],
    ])
  })
})

describe('resetStaleSessions', () => {
  it('sets running and waiting sessions to stopped at startup', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    for (const status of ['idle', 'running', 'waiting_approval', 'error']) {
      db.prepare('INSERT INTO code_sessions (title, project_path, status) VALUES (?, ?, ?)').run(status, '/x', status)
    }
    expect(resetStaleSessions(db)).toBe(2)
    expect(db.prepare('SELECT status FROM code_sessions ORDER BY id').all().map((r) => r.status)).toEqual(['idle', 'stopped', 'stopped', 'error'])
  })
})

describe('migration 0006', () => {
  it('adds permission_mode with default "default" to existing sessions and validates it', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    db.exec('ALTER TABLE code_sessions DROP COLUMN permission_mode; DELETE FROM schema_migrations WHERE version = 6')
    db.exec("INSERT INTO code_sessions (title, project_path) VALUES ('s', '/x')")
    expect(migrate(db)).toEqual(['0006_code_permission_mode.sql'])
    expect(db.prepare('SELECT permission_mode FROM code_sessions').get()).toEqual({ permission_mode: 'default' })
    expect(() => db.exec("UPDATE code_sessions SET permission_mode = 'bypassPermissions'")).toThrow()
  })
})

describe('permission mode', () => {
  it('defaults to default, persists via PATCH, emits a mode event and rejects bypassPermissions', async () => {
    const { send, codeMode, session, events } = setup()
    await codeMode()
    const s = await session()
    expect(s.permissionMode).toBe('default')
    const res = await send('PATCH', `/code/sessions/${s.id}`, { permissionMode: 'acceptEdits' })
    expect(res.body.permissionMode).toBe('acceptEdits')
    expect((await send('GET', `/code/sessions/${s.id}`)).body.session.permissionMode).toBe('acceptEdits')
    expect((await events(s.id)).filter((e) => e.type === 'mode').map((e) => e.payload.mode)).toEqual(['acceptEdits'])
    for (const bad of ['bypassPermissions', 'dontAsk', 'x']) expect((await send('PATCH', `/code/sessions/${s.id}`, { permissionMode: bad })).status).toBe(400)
    expect((await send('PATCH', `/code/sessions/${s.id}`, {})).status).toBe(400)
    expect((await send('PATCH', `/code/sessions/${s.id}`, { title: 'T', permissionMode: 'plan' })).body).toMatchObject({ title: 'T', permissionMode: 'plan' })
  })

  it('a mode change reaches a running turn and the fake runner skips the approval in acceptEdits', async () => {
    const { send, codeMode, session, waitFor } = setup()
    await codeMode()
    const s = await session()
    await send('PATCH', `/code/sessions/${s.id}`, { permissionMode: 'acceptEdits' })
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'please edit README' })
    const done = await waitFor(s.id, 'idle')
    expect(done.events.some((e: { type: string }) => e.type === 'approval_request')).toBe(false)
    expect(done.events.find((e: { type: string }) => e.type === 'context').payload.percentage).toBe(12.5)
  })

  it('passes the live mode to the runner and notifies it of changes', async () => {
    const seen: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const runner: AgentRunner = {
      available: async () => ({ ok: true }),
      async *runTurn(input) {
        seen.push(input.getPermissionMode())
        input.onPermissionMode((m) => seen.push(`->${m}`))
        await gate
        seen.push(input.getPermissionMode())
        yield { type: 'result', isError: false }
      },
    }
    const { send, codeMode, session, waitFor } = setup(runner)
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'go' })
    await send('PATCH', `/code/sessions/${s.id}`, { permissionMode: 'plan' })
    release()
    await waitFor(s.id, 'idle')
    expect(seen).toEqual(['default', '->plan', 'plan'])
  })
})

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' })

describe('git info and changes', () => {
  it('reports no git repo for a plain folder', async () => {
    const { send, codeMode, session } = setup()
    await codeMode()
    const s = await session()
    expect((await send('GET', `/code/sessions/${s.id}/git`)).body).toEqual({ isGitRepo: false })
    expect((await send('GET', `/code/sessions/${s.id}/changes`)).body).toEqual({ isGitRepo: false, files: [] })
  })

  it('shows branch and dirty flag, and lists modified, deleted, renamed, added and untracked files with diffs', async () => {
    const { send, codeMode, session } = setup()
    await codeMode()
    const dir = projectDir()
    git(dir, 'init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(dir, 'gone.txt'), 'bye\n')
    writeFileSync(join(dir, 'old name.txt'), 'rename me please\nsecond line\nthird line\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'init')
    const s = await session(dir)
    expect((await send('GET', `/code/sessions/${s.id}/git`)).body).toEqual({ isGitRepo: true, branch: 'main', dirty: false })

    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\n')
    git(dir, 'rm', '-q', 'gone.txt')
    git(dir, 'mv', 'old name.txt', 'new name.txt')
    writeFileSync(join(dir, 'staged.txt'), 'x\n')
    git(dir, 'add', 'staged.txt')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'u.txt'), 'u1\nu2\n')

    expect((await send('GET', `/code/sessions/${s.id}/git`)).body).toEqual({ isGitRepo: true, branch: 'main', dirty: true })
    const { isGitRepo, files } = (await send('GET', `/code/sessions/${s.id}/changes`)).body
    expect(isGitRepo).toBe(true)
    const by = Object.fromEntries(files.map((f: { path: string }) => [f.path, f]))
    expect(by['a.txt']).toMatchObject({ status: 'modified', added: 2, removed: 1, truncated: false })
    expect(by['a.txt'].diff).toContain('+TWO')
    expect(by['a.txt'].diff).toContain('-two')
    expect(by['gone.txt']).toMatchObject({ status: 'deleted', added: 0, removed: 1 })
    expect(by['new name.txt']).toMatchObject({ status: 'renamed', oldPath: 'old name.txt' })
    expect(by['staged.txt']).toMatchObject({ status: 'added', added: 1 })
    expect(by['sub/u.txt']).toMatchObject({ status: 'untracked', added: 2, removed: 0 })
    expect(by['sub/u.txt'].diff).toContain('+u1')
  })

  it('truncates a huge diff', async () => {
    const { send, codeMode, session } = setup()
    await codeMode()
    const dir = projectDir()
    git(dir, 'init', '-q')
    writeFileSync(join(dir, 'f.txt'), 'x\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'init')
    writeFileSync(join(dir, 'f.txt'), `${'line of text\n'.repeat(30_000)}`)
    const s = await session(dir)
    const f = (await send('GET', `/code/sessions/${s.id}/changes`)).body.files[0]
    expect(f.truncated).toBe(true)
    expect(f.diff.length).toBeLessThanOrEqual(200 * 1024)
    expect(f.added).toBe(30_000)
  })

  it('records the SessionStart hook message of a new session as a notice, and loads the commands before the first turn', async () => {
    const fake = createFakeRunner()
    const runner: AgentRunner = { ...fake, probe: async () => ({ commands: ['save', 'fetch-save'], notices: ['Last save: X – load with /fetch-save'] }) }
    const { send, codeMode, session } = setup(runner)
    await codeMode()
    const created = await session()
    const detail = (await send('GET', `/code/sessions/${created.id}`)).body
    expect(detail.slashCommands).toEqual(['save', 'fetch-save'])
    expect(detail.events).toEqual([expect.objectContaining({ seq: 1, type: 'notice', payload: { text: 'Last save: X – load with /fetch-save', source: 'SessionStart' } })])
  })

  it('files cards in folders below the project folder and finds them', async () => {
    let found = ''
    let none = ''
    const runner: AgentRunner = {
      available: async () => ({ ok: true }),
      async *runTurn({ cardTools }) {
        await cardTools.recordCard({ title: 'Agent runner', body: 'b', folder: 'backend/agent' })
        await cardTools.recordCard({ title: 'Escape', body: 'b', folder: '../../etc' })
        found = await cardTools.findCards({})
        none = await cardTools.findCards({ query: 'nothing like this' })
        yield { type: 'result', isError: false }
      },
    }
    const { send, codeMode, session, waitFor } = setup(runner)
    await codeMode()
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: 'go' })
    await waitFor(s.id, 'idle')
    const root = cardRoot(s.projectPath)
    expect((await send('GET', '/cards/1')).body.folderPath).toBe(`${root}/backend/agent`)
    expect((await send('GET', '/cards/2')).body.folderPath).toBe(`${root}/etc`)
    expect(found).toBe(`[c1] Agent runner (folder: ${root}/backend/agent) – proposed, not reviewed yet\n[c2] Escape (folder: ${root}/etc) – proposed, not reviewed yet`)
    expect(none).toBe('No cards match "nothing like this".')
  })

  it('adds the content of cards the user references as [cN] to the prompt', async () => {
    const prompts: string[] = []
    const base = createFakeRunner()
    const spy: AgentRunner = { available: base.available, runTurn: (input) => (prompts.push(input.prompt), base.runTurn(input)) }
    const { send, codeMode, session, waitFor } = setup(spy)
    await codeMode()
    const note = (await send('POST', '/cards', { title: 'Retry policy', body: 'Three attempts, then give up.' })).body
    const s = await session()
    await send('POST', `/code/sessions/${s.id}/messages`, { text: `apply [c${note.id}] and [c999]` })
    await waitFor(s.id, 'idle')
    expect(prompts[0]).toBe(`<promptsys-cards>\nReferenced by the user in this message:\n[c${note.id}] Retry policy (folder: /):\nThree attempts, then give up.\n</promptsys-cards>\n\napply [c${note.id}] and [c999]`)
  })
})

describe('cardFolder', () => {
  it('keeps the agent inside the project folder', () => {
    expect(cardFolder('/x/My Project', undefined)).toBe('My Project')
    expect(cardFolder('/x/p', ' Backend / api/ ')).toBe('p/Backend/api')
    expect(cardFolder('/x/p', '../..//a:b')).toBe('p/a-b')
  })
})
