import { describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { migrate, openDatabase } from '../db/index.ts'

function appWith(development: boolean) {
  const db = openDatabase(':memory:')
  migrate(db)
  return createApp({ db, security: { port: 8000, development } })
}

const get = (app: ReturnType<typeof appWith>, headers: Record<string, string>, path = '/api/health') =>
  app.request(path, { headers })

describe('Host/Origin check', () => {
  it('accepts the local hosts without an Origin', async () => {
    const app = appWith(false)
    expect((await get(app, { host: '127.0.0.1:8000' })).status).toBe(200)
    expect((await get(app, { host: 'localhost:8000' })).status).toBe(200)
    expect((await get(app, { host: 'LOCALHOST:8000' })).status).toBe(200)
  })

  it('accepts the app origin', async () => {
    const app = appWith(false)
    expect((await get(app, { host: '127.0.0.1:8000', origin: 'http://127.0.0.1:8000' })).status).toBe(200)
    expect((await get(app, { host: 'localhost:8000', origin: 'http://localhost:8000' })).status).toBe(200)
  })

  it('rejects other hosts (DNS rebinding) with the error envelope', async () => {
    const res = await get(appWith(false), { host: 'evil.example:8000' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden_origin', requestId: expect.any(String) } })
  })

  it('rejects a wrong port and a missing Host', async () => {
    const app = appWith(false)
    expect((await get(app, { host: 'localhost:9999' })).status).toBe(403)
    expect((await get(app, {})).status).toBe(403)
    expect((await get(app, { host: 'localhost' })).status).toBe(403)
  })

  it('rejects foreign origins, also for writes', async () => {
    const app = appWith(false)
    for (const origin of ['https://evil.example', 'http://localhost:8001', 'https://localhost:8000', 'null']) {
      const res = await app.request('/api/cards', {
        method: 'POST',
        headers: { host: '127.0.0.1:8000', origin, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      })
      expect(res.status, origin).toBe(403)
    }
    const list = await app.request('/api/cards', { headers: { host: '127.0.0.1:8000' } })
    expect(await list.json()).toEqual([]) // nothing was created
  })

  it('allows the Vite dev server only in development', async () => {
    const dev = appWith(true)
    expect((await get(dev, { host: 'localhost:5173', origin: 'http://localhost:5173' })).status).toBe(200)
    expect((await get(dev, { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).status).toBe(200)
    expect((await get(dev, { host: '127.0.0.1:8000', origin: 'http://localhost:5173' })).status).toBe(200)
    const prod = appWith(false)
    expect((await get(prod, { host: 'localhost:5173', origin: 'http://localhost:5173' })).status).toBe(403)
    expect((await get(prod, { host: '127.0.0.1:8000', origin: 'http://localhost:5173' })).status).toBe(403)
  })

  it('also protects unknown routes', async () => {
    expect((await get(appWith(false), { host: 'evil.example' }, '/nope')).status).toBe(403)
  })
})
