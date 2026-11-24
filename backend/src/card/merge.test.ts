import { describe, expect, it } from 'vitest'
import { createTestApp } from '../testing.ts'

function setup() {
  const { app, db } = createTestApp()
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
  const card = async (title: string, body = '', extra: Record<string, unknown> = {}) =>
    (await send('POST', '/cards', { title, body, ...extra })).body
  const link = async (sourceId: number, targetId: number, kind = 'related') =>
    (await send('POST', '/links', { sourceId, targetId, kind })).body
  const allLinks = () =>
    db
      .prepare('SELECT id, source_id AS s, target_id AS t, kind FROM card_links ORDER BY id')
      .all()
      .map((r) => `${r.s}>${r.t}:${r.kind}`)
  return { send, card, link, allLinks, db }
}

describe('merge preview', () => {
  it('proposes target body plus each source under its title, and counts movable links', async () => {
    const { send, card, link } = setup()
    await card('Target', 'target text')
    await card('Source A', 'text a')
    await card('Source B', '')
    await card('Other')
    await link(2, 4)
    await link(3, 4, 'part_of')
    await link(2, 1) // becomes a self-link
    const res = await send('POST', '/merges/preview', { targetId: 1, sourceIds: [2, 3] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      title: 'Target',
      body: 'target text\n\n## Source A\n\ntext a\n\n## Source B',
      linkCount: 2,
    })
  })

  it('does not change anything', async () => {
    const { send, card, db } = setup()
    await card('A')
    await card('B')
    await send('POST', '/merges/preview', { targetId: 1, sourceIds: [2] })
    expect(db.prepare('SELECT count(*) AS n FROM card_merges').get()?.n).toBe(0)
    expect((await send('GET', '/cards/2')).body.archivedAt).toBeNull()
  })

  it('does not count duplicates of existing target links', async () => {
    const { send, card, link } = setup()
    await card('T')
    await card('S')
    await card('X')
    await link(1, 3)
    await link(3, 2) // related, other direction: same pair as 1-3 after merge
    expect((await send('POST', '/merges/preview', { targetId: 1, sourceIds: [2] })).body.linkCount).toBe(0)
  })
})

describe('merge validation', () => {
  it.each([
    ['target among sources', { targetId: 1, sourceIds: [1, 2] }],
    ['empty sources', { targetId: 1, sourceIds: [] }],
  ])('rejects %s with invalid_merge on preview and merge', async (_name, payload) => {
    const { send, card } = setup()
    await card('A')
    await card('B')
    for (const path of ['/merges/preview', '/merges']) {
      const res = await send('POST', path, { ...payload, title: 'T', body: '' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('invalid_merge')
    }
  })

  it('rejects archived cards and cards that were already merged away', async () => {
    const { send, card } = setup()
    await card('A')
    await card('B')
    await card('C')
    await card('D')
    await send('DELETE', '/cards/2')
    await send('POST', '/merges', { targetId: 3, sourceIds: [4], title: 'C', body: '' })
    for (const payload of [
      { targetId: 1, sourceIds: [2] }, // archived source
      { targetId: 2, sourceIds: [1] }, // archived target
      { targetId: 1, sourceIds: [4] }, // merged source
      { targetId: 4, sourceIds: [1] }, // merged target
    ]) {
      const res = await send('POST', '/merges', { ...payload, title: 'T', body: '' })
      expect(res.body.error.code).toBe('invalid_merge')
    }
  })

  it('answers 404 card_not_found for unknown cards and 400 for malformed input', async () => {
    const { send, card } = setup()
    await card('A')
    expect((await send('POST', '/merges', { targetId: 1, sourceIds: [9], title: 'T', body: '' })).body.error.code).toBe('card_not_found')
    expect((await send('POST', '/merges/preview', { targetId: 9, sourceIds: [1] })).status).toBe(404)
    expect((await send('POST', '/merges', { targetId: 1, sourceIds: [1.5], title: 'T', body: '' })).body.error.code).toBe('validation_failed')
    expect((await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: ' ', body: '' })).body.error.code).toBe('validation_failed')
    expect((await send('POST', '/merges/preview', { targetId: 1 })).body.error.code).toBe('validation_failed')
  })

  it('changes nothing when a request fails', async () => {
    const { send, card, db } = setup()
    await card('A')
    await card('B')
    await send('POST', '/merges', { targetId: 1, sourceIds: [2, 2, 7], title: 'T', body: '' })
    expect(db.prepare('SELECT version FROM cards WHERE id = 1').get()?.version).toBe(1)
    expect(db.prepare('SELECT count(*) AS n FROM card_merges').get()?.n).toBe(0)
  })
})

describe('merge', () => {
  it('stores the text as a new target version, archives the sources and records the merge', async () => {
    const { send, card, db } = setup()
    await card('A', 'a text')
    await card('B', 'b text', { defaultIncluded: true })
    await card('C', 'c text')
    const res = await send('POST', '/merges', { targetId: 1, sourceIds: [2, 3], title: 'Merged', body: 'merged text' })
    expect(res.status).toBe(201)
    expect(res.body.target).toMatchObject({ id: 1, title: 'Merged', body: 'merged text', version: 2, defaultIncluded: true })
    expect(res.body.merges).toMatchObject([
      { id: 1, targetId: 1, sourceId: 2, sourceTitle: 'B', targetVersionBefore: 1, undoneAt: null },
      { id: 2, targetId: 1, sourceId: 3, sourceTitle: 'C', targetVersionBefore: 1, undoneAt: null },
    ])
    expect((await send('GET', '/cards/1/versions')).body.map((v: { version: number }) => v.version)).toEqual([2, 1])
    const source = (await send('GET', '/cards/2')).body
    expect(source.archivedAt).not.toBeNull()
    expect(source.mergedInto).toBe(1)
    expect((await send('GET', '/cards')).body.map((c: { id: number }) => c.id)).toEqual([1])
    expect(db.prepare('SELECT source_body FROM card_merges WHERE id = 1').get()?.source_body).toBe('b text')
  })

  it('moves links to the target and drops self-links and duplicates', async () => {
    const { send, card, link, allLinks } = setup()
    for (const t of ['T', 'S', 'X', 'Y', 'Z']) await card(t)
    await link(1, 3) // existing target link
    await link(3, 2) // duplicate of 1-3 after the merge (related is undirected)
    await link(2, 4) // moves
    await link(5, 2, 'part_of') // moves, keeps direction
    await link(2, 1) // self-link after the merge
    await link(1, 5, 'part_of') // existing, opposite direction of the moved link, so both stay
    const res = await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: 'T', body: '' })
    expect(res.status).toBe(201)
    expect(allLinks()).toEqual(['1>3:related', '1>4:related', '5>1:part_of', '1>5:part_of'])
    const target = (await send('GET', '/cards/1')).body
    expect(target.links.map((l: { targetId: number; kind: string }) => `${l.targetId}:${l.kind}`).sort()).toEqual(['3:related', '4:related', '5:part_of'])
    expect(target.backlinks.map((l: { sourceId: number; kind: string }) => `${l.sourceId}:${l.kind}`)).toEqual(['5:part_of'])
    expect((await send('GET', '/cards/2')).body.links).toEqual([])
    expect((await send('GET', '/cards/2')).body.backlinks).toEqual([])
  })

  it('merges several sources, dropping links between them', async () => {
    const { send, card, link } = setup()
    for (const t of ['T', 'A', 'B', 'X']) await card(t)
    await link(2, 3)
    await link(2, 4)
    await link(3, 4) // duplicate of 2-4 once both point to T
    const preview = await send('POST', '/merges/preview', { targetId: 1, sourceIds: [2, 3] })
    expect(preview.body.linkCount).toBe(1)
    await send('POST', '/merges', { targetId: 1, sourceIds: [2, 3], title: 'T', body: '' })
    const target = (await send('GET', '/cards/1')).body
    expect(target.links.map((l: { targetId: number }) => l.targetId)).toEqual([4])
    expect(target.backlinks).toEqual([])
  })

  it('resolves mergedInto through the chain and refuses links to merged-away cards', async () => {
    const { send, card } = setup()
    await card('A')
    await card('B')
    await card('C')
    await send('POST', '/merges', { targetId: 2, sourceIds: [1], title: 'B', body: '' })
    expect((await send('GET', '/cards/1')).body.mergedInto).toBe(2)
    await send('POST', '/merges', { targetId: 3, sourceIds: [2], title: 'C', body: '' })
    expect((await send('GET', '/cards/1')).body.mergedInto).toBe(3)
    expect((await send('GET', '/cards/2')).body.mergedInto).toBe(3)
    expect((await send('GET', '/cards/3')).body.mergedInto).toBeNull()
    const res = await send('POST', '/links', { sourceId: 1, targetId: 3 })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('card_archived')
    expect((await send('POST', '/cards/1/restore')).body.error.code).toBe('card_merged')
  })
})

describe('undo merge', () => {
  it('restores the source with its links and the target text as a new version', async () => {
    const { send, card, link, allLinks } = setup()
    for (const t of ['T', 'S', 'X', 'Y']) await card(t, `${t} text`)
    await link(1, 3)
    await link(3, 2) // dropped as duplicate
    await link(2, 4, 'part_of') // moved
    await link(2, 1) // dropped as self-link
    const before = allLinks()
    const merged = await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: 'M', body: 'merged' })
    expect(allLinks()).not.toEqual(before)

    const res = await send('POST', `/merges/${merged.body.merges[0].id}/undo`)
    expect(res.status).toBe(200)
    expect(res.body.restored[0]).toMatchObject({ id: 2, title: 'S', body: 'S text', archivedAt: null, mergedInto: null })
    expect(res.body.target).toMatchObject({ id: 1, title: 'T', body: 'T text', version: 3 })
    expect([...allLinks()].sort()).toEqual([...before].sort())
    const versions = (await send('GET', '/cards/1/versions')).body
    expect(versions.map((v: { version: number; body: string }) => `${v.version}:${v.body}`)).toEqual(['3:T text', '2:merged', '1:T text'])
    expect((await send('GET', '/cards')).body).toHaveLength(4)
    expect((await send('POST', '/links', { sourceId: 2, targetId: 3, kind: 'contradicts' })).status).toBe(201)
  })

  it('answers 409 when undone twice and 404 for an unknown merge', async () => {
    const { send, card, db } = setup()
    await card('A')
    await card('B')
    await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: 'A', body: '' })
    expect((await send('POST', '/merges/1/undo')).status).toBe(200)
    expect(db.prepare('SELECT undone_at FROM card_merges WHERE id = 1').get()?.undone_at).not.toBeNull()
    const again = await send('POST', '/merges/1/undo')
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('merge_already_undone')
    expect((await send('POST', '/merges/9/undo')).body.error.code).toBe('merge_not_found')
    expect((await send('POST', '/merges/abc/undo')).body.error.code).toBe('validation_failed')
  })

  it('undoes all sources of one merge operation together', async () => {
    const { send, card, link } = setup()
    for (const t of ['T', 'A', 'B', 'X']) await card(t, `${t} text`)
    await link(2, 3) // dropped, since both sources go away
    await link(3, 4)
    await send('POST', '/merges', { targetId: 1, sourceIds: [2, 3], title: 'T', body: 'm' })
    const res = await send('POST', '/merges/2/undo') // any merge of the group undoes the whole group
    expect(res.status).toBe(200)
    expect(res.body.restored.map((c: { id: number }) => c.id)).toEqual([2, 3])
    expect(res.body.restored.every((c: { archivedAt: unknown }) => c.archivedAt === null)).toBe(true)
    expect(res.body.target).toMatchObject({ body: 'T text', version: 3 })
    expect((await send('GET', '/cards/2')).body.links.map((l: { targetId: number }) => l.targetId)).toEqual([3])
    expect((await send('GET', '/cards/3')).body.links.map((l: { targetId: number }) => l.targetId)).toEqual([4])
    expect((await send('POST', '/merges/1/undo')).body.error.code).toBe('merge_already_undone')
  })

  it('refuses undo with 409 merge_outdated when the target was edited after the merge', async () => {
    const { send, card, db } = setup()
    await card('A', 'a')
    await card('B', 'b')
    await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: 'A', body: 'merged' })
    await send('PATCH', '/cards/1', { body: 'edited later' })
    const res = await send('POST', '/merges/1/undo')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('merge_outdated')
    expect((await send('GET', '/cards/2')).body.archivedAt).not.toBeNull()
    expect((await send('GET', '/cards/1')).body.body).toBe('edited later')
    expect(db.prepare('SELECT undone_at FROM card_merges WHERE id = 1').get()?.undone_at).toBeNull()
  })

  it('refuses to undo while the target is archived', async () => {
    const { send, card } = setup()
    await card('A')
    await card('B')
    await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: 'A', body: '' })
    await send('DELETE', '/cards/1')
    expect((await send('POST', '/merges/1/undo')).body.error.code).toBe('card_archived')
  })

  it('does not bring back links to cards that are archived in the meantime', async () => {
    const { send, card, link } = setup()
    for (const t of ['T', 'S', 'X']) await card(t)
    await link(2, 3)
    await send('POST', '/merges', { targetId: 1, sourceIds: [2], title: 'T', body: '' })
    await send('DELETE', '/cards/3')
    const res = await send('POST', '/merges/1/undo')
    expect(res.body.restored[0].links).toEqual([])
  })
})
