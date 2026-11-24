import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { migrate, openDatabase } from './db/index.ts'

function appWithFrontend() {
  const dist = mkdtempSync(join(tmpdir(), 'promptsys-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>PromptSys</title>')
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
  const db = openDatabase(':memory:')
  migrate(db)
  return createApp({ db, frontendDist: dist, security: { port: 8000, development: false } })
}

const get = (app: ReturnType<typeof appWithFrontend>, path: string) =>
  app.request(`http://127.0.0.1:8000${path}`, { headers: { host: '127.0.0.1:8000' } })

describe('serving the built frontend', () => {
  it('serves index.html at / and for client-side routes', async () => {
    const app = appWithFrontend()
    for (const path of ['/', '/chat/c1', '/graph']) {
      const res = await get(app, path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<title>PromptSys</title>')
    }
  })

  it('serves static assets', async () => {
    const res = await get(appWithFrontend(), '/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log(1)')
  })

  it('keeps /api routes and answers unknown /api paths and missing files with 404', async () => {
    const app = appWithFrontend()
    expect((await get(app, '/api/health')).status).toBe(200)
    const unknownApi = await get(app, '/api/nope')
    expect(unknownApi.status).toBe(404)
    expect(unknownApi.headers.get('content-type')).toContain('application/json')
    expect((await get(app, '/assets/missing.js')).status).toBe(404)
  })

  it('still applies the Host check to the frontend', async () => {
    const res = await appWithFrontend().request('http://evil.example/', { headers: { host: 'evil.example' } })
    expect(res.status).toBe(403)
  })
})
