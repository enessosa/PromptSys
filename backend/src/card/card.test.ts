import { describe, expect, it } from 'vitest'
import { createTestApp } from '../testing.ts'

function setup() {
  const { app, db } = createTestApp()
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: the response shape is checked by the assertions
    const json: any = text ? JSON.parse(text) : undefined
    return { status: res.status, body: json }
  }
  const card = async (title: string, extra: Record<string, unknown> = {}) =>
    (await send('POST', '/cards', { title, ...extra })).body
  return { send, card, db }
}

describe('cards', () => {
  it('creates cards with consecutive ids, defaults and a first version', async () => {
    const { send } = setup()
    const res = await send('POST', '/cards', { title: ' First ', body: 'hello' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: 1,
      title: 'First',
      body: 'hello',
      kind: 'note',
      folderPath: '',
      defaultIncluded: false,
      version: 1,
      archivedAt: null,
      mergedInto: null,
      links: [],
      backlinks: [],
    })
    expect((await send('POST', '/cards', { title: 'Second', kind: 'memory', folderPath: '/project/api/' })).body).toMatchObject({
      id: 2,
      kind: 'memory',
      folderPath: 'project/api',
    })
    expect((await send('GET', '/cards/1/versions')).body).toMatchObject([{ version: 1, title: 'First', body: 'hello' }])
  })

  it('lists cards without body but with an excerpt, and filters them', async () => {
    const { send, card } = setup()
    await card('Alpha', { body: 'x'.repeat(300), folderPath: 'p' })
    await card('Beta 100%', { body: 'about keys', kind: 'memory', folderPath: 'p/sub' })
    await card('Gamma', { folderPath: 'other' })
    const all = (await send('GET', '/cards')).body
    expect(all).toHaveLength(3)
    expect(all[0].body).toBeUndefined()
    expect(all[0].excerpt).toHaveLength(200)
    const ids = async (q: string) => (await send('GET', `/cards${q}`)).body.map((c: { id: number }) => c.id)
    expect(await ids('?folder=p')).toEqual([1, 2])
    expect(await ids('?kind=memory')).toEqual([2])
    expect(await ids('?query=keys')).toEqual([2])
    expect(await ids('?query=100%25')).toEqual([2])
    expect(await ids('?query=%25')).toEqual([2])
    expect((await send('GET', '/cards?kind=video')).status).toBe(400)
  })

  it('archives instead of deleting, hides archived cards and restores them', async () => {
    const { send, card } = setup()
    await card('a')
    await card('b')
    expect((await send('DELETE', '/cards/1')).status).toBe(204)
    expect((await send('DELETE', '/cards/1')).status).toBe(204)
    expect((await send('GET', '/cards')).body.map((c: { id: number }) => c.id)).toEqual([2])
    expect((await send('GET', '/cards?includeArchived=true')).body).toHaveLength(2)
    expect((await send('GET', '/cards/1')).body.archivedAt).not.toBeNull()
    expect((await send('PATCH', '/cards/1', { title: 'x' })).body.error.code).toBe('card_archived')
    expect((await send('POST', '/cards/1/restore')).body.archivedAt).toBeNull()
    expect((await card('c')).id).toBe(3)
  })

  it('writes a new version only when title or body change', async () => {
    const { send, card } = setup()
    await card('a', { body: 'one' })
    const moved = await send('PATCH', '/cards/1', { folderPath: 'x', defaultIncluded: true, kind: 'rule' })
    expect(moved.body).toMatchObject({ version: 1, folderPath: 'x', defaultIncluded: true, kind: 'rule' })
    const edited = await send('PATCH', '/cards/1', { body: 'two' })
    expect(edited.body).toMatchObject({ version: 2, body: 'two', title: 'a' })
    const versions = (await send('GET', '/cards/1/versions')).body
    expect(versions.map((v: { version: number; body: string }) => [v.version, v.body])).toEqual([
      [2, 'two'],
      [1, 'one'],
    ])
  })

  it('rejects an update with an outdated ifVersion', async () => {
    const { send, card } = setup()
    await card('a')
    await send('PATCH', '/cards/1', { title: 'b' })
    const res = await send('PATCH', '/cards/1', { title: 'c', ifVersion: 1 })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'version_conflict', details: { currentVersion: 2 } })
    expect((await send('PATCH', '/cards/1', { title: 'c', ifVersion: 2 })).body.version).toBe(3)
  })

  it('uses the error envelope for missing cards, invalid ids, bad input and unknown routes', async () => {
    const { send } = setup()
    const missing = await send('GET', '/cards/9')
    expect(missing.status).toBe(404)
    expect(missing.body.error).toMatchObject({ code: 'card_not_found', message: 'Card c9 not found' })
    expect(typeof missing.body.error.requestId).toBe('string')
    expect((await send('GET', '/cards/abc')).status).toBe(400)
    const invalid = await send('POST', '/cards', { title: '', kind: 'video' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('validation_failed')
    expect(invalid.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['kind', 'title'])
    expect((await send('PATCH', '/cards/1', {})).status).toBe(400)
    expect((await send('POST', '/cards', '{nope')).body.error.code).toBe('validation_failed')
    const route = await send('GET', '/nothing')
    expect(route.status).toBe(404)
    expect(route.body.error.code).toBe('not_found')
  })
})

describe('card links', () => {
  it('creates a link and shows it on both cards', async () => {
    const { send, card } = setup()
    await card('a')
    await card('b')
    const res = await send('POST', '/links', { sourceId: 1, targetId: 2, label: ' supports ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 1, sourceId: 1, targetId: 2, kind: 'related', label: 'supports' })
    expect((await send('GET', '/cards/1')).body.links).toHaveLength(1)
    expect((await send('GET', '/cards/2')).body.backlinks).toHaveLength(1)
  })

  it('rejects self-links, unknown cards and duplicates (related in either direction)', async () => {
    const { send, card } = setup()
    await card('a')
    await card('b')
    expect((await send('POST', '/links', { sourceId: 1, targetId: 1 })).body.error.code).toBe('invalid_link')
    expect((await send('POST', '/links', { sourceId: 1, targetId: 7 })).body.error.code).toBe('card_not_found')
    await send('POST', '/links', { sourceId: 1, targetId: 2 })
    expect((await send('POST', '/links', { sourceId: 2, targetId: 1 })).body.error.code).toBe('link_exists')
    expect((await send('POST', '/links', { sourceId: 1, targetId: 2 })).status).toBe(409)
    expect((await send('POST', '/links', { sourceId: 2, targetId: 1, kind: 'part_of' })).status).toBe(201)
    expect((await send('POST', '/links', { sourceId: 2, targetId: 1, kind: 'part_of' })).status).toBe(409)
  })

  it('updates and deletes links', async () => {
    const { send, card } = setup()
    await card('a')
    await card('b')
    await send('POST', '/links', { sourceId: 1, targetId: 2, kind: 'part_of' })
    await send('POST', '/links', { sourceId: 2, targetId: 1, kind: 'related' })
    expect((await send('PATCH', '/links/1', { label: 'x', kind: 'contradicts' })).body).toMatchObject({ label: 'x', kind: 'contradicts' })
    expect((await send('PATCH', '/links/1', { kind: 'related' })).body.error.code).toBe('link_exists')
    expect((await send('PATCH', '/links/1', { label: null })).body.label).toBeNull()
    expect((await send('PATCH', '/links/9', { label: 'x' })).body.error.code).toBe('link_not_found')
    expect((await send('DELETE', '/links/1')).status).toBe(204)
    expect((await send('DELETE', '/links/1')).status).toBe(404)
  })

  it('removes links with a hard-deleted card but keeps them when it is archived', async () => {
    const { send, card, db } = setup()
    await card('a')
    await card('b')
    await send('POST', '/links', { sourceId: 1, targetId: 2 })
    await send('DELETE', '/cards/1')
    expect((await send('GET', '/cards/2')).body.backlinks).toHaveLength(1)
    db.exec('DELETE FROM cards WHERE id = 1')
    expect((await send('GET', '/cards/2')).body.backlinks).toEqual([])
  })
})

describe('graph', () => {
  it('returns active cards as nodes with degree, and the links between them', async () => {
    const { send, card } = setup()
    await card('a')
    await card('b', { kind: 'memory' })
    await card('c')
    await send('POST', '/links', { sourceId: 1, targetId: 2 })
    await send('POST', '/links', { sourceId: 2, targetId: 3, kind: 'part_of' })
    await send('DELETE', '/cards/3')
    const graph = (await send('GET', '/graph')).body
    expect(graph.nodes).toEqual([
      { id: 1, title: 'a', kind: 'note', folderPath: '', x: null, y: null, degree: 1 },
      { id: 2, title: 'b', kind: 'memory', folderPath: '', x: null, y: null, degree: 1 },
    ])
    expect(graph.links).toHaveLength(1)
    expect((await send('GET', '/graph?kind=memory')).body).toMatchObject({ nodes: [{ id: 2, degree: 0 }], links: [] })
  })

  it('stores node positions in one batch, all or nothing', async () => {
    const { send, card } = setup()
    await card('a')
    await card('b')
    const ok = await send('PUT', '/graph/positions', { positions: [{ id: 1, x: 10.5, y: -3 }, { id: 2, x: 0, y: 1 }] })
    expect(ok.status).toBe(204)
    expect((await send('GET', '/graph')).body.nodes.map((n: { x: number; y: number }) => [n.x, n.y])).toEqual([
      [10.5, -3],
      [0, 1],
    ])
    const bad = await send('PUT', '/graph/positions', { positions: [{ id: 1, x: 99, y: 99 }, { id: 8, x: 0, y: 0 }] })
    expect(bad.status).toBe(404)
    expect((await send('GET', '/graph')).body.nodes[0]).toMatchObject({ x: 10.5, y: -3 })
    expect((await send('PUT', '/graph/positions', { positions: [{ id: 1, x: 'a', y: 0 }] })).status).toBe(400)
  })
})
