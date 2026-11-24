import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, buildUrl } from './client.ts'

function respond(status: number, body?: unknown, raw?: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status })),
  )
}

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds query strings and skips empty values', () => {
    expect(buildUrl('/api/cards', { query: 'a b', kind: undefined, folder: '' })).toBe('/api/cards?query=a+b')
    expect(buildUrl('/api/cards')).toBe('/api/cards')
  })

  it('returns parsed JSON and undefined for 204', async () => {
    respond(200, { ok: 1 })
    expect(await api('/x')).toEqual({ ok: 1 })
    respond(204)
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined()
  })

  it('maps the error envelope to an ApiError', async () => {
    respond(409, {
      error: { code: 'version_conflict', message: 'Changed', details: [{ path: 'ifVersion', message: 'stale' }], requestId: 'r1' },
    })
    const err = await api('/x', { method: 'PATCH', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 409,
      code: 'version_conflict',
      message: 'Changed',
      requestId: 'r1',
      details: [{ path: 'ifVersion', message: 'stale' }],
    })
  })

  it('falls back to http_<status> for answers without envelope', async () => {
    respond(502, undefined, '<html>Bad gateway</html>')
    await expect(api('/x')).rejects.toMatchObject({ status: 502, code: 'http_502' })
  })

  it('reports an unreachable backend as network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(api('/x')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('sends JSON bodies with a content type', async () => {
    const fn = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fn)
    await api('/x', { body: { a: 1 } })
    const init = (fn.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })
})
