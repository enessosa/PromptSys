import { describe, expect, it } from 'vitest'
import { createTestApp } from '../testing.ts'

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper
const call = async (app: ReturnType<typeof createTestApp>['app'], method: string, body?: unknown) => {
  const res = await app.request('/api/settings', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as Json }
}

describe('settings', () => {
  it('returns defaults, merges partial updates and keeps them', async () => {
    const { app } = createTestApp()
    expect((await call(app, 'GET')).body).toEqual({ defaultModel: null, ablationRuns: 3, baselineRuns: 3, ablationTemperature: 0.2, accentColor: null })
    const put = await call(app, 'PUT', { ablationRuns: 5, accentColor: '#7c5cff', defaultModel: 'claude-x' })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ ablationRuns: 5, baselineRuns: 3, accentColor: '#7c5cff', defaultModel: 'claude-x' })
    expect((await call(app, 'PUT', { accentColor: null })).body.accentColor).toBeNull()
    expect((await call(app, 'GET')).body).toMatchObject({ ablationRuns: 5, defaultModel: 'claude-x' })
  })

  it('validates values and refuses unknown keys such as secrets', async () => {
    const { app } = createTestApp()
    for (const bad of [{ ablationRuns: 0 }, { ablationTemperature: 2 }, { accentColor: 'red' }, { baselineRuns: 1.5 }, { anthropicApiKey: 'sk-x' }]) {
      const res = await call(app, 'PUT', bad)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation_failed')
    }
  })

  it('falls back to the default for a stored value that is broken', async () => {
    const { app, db } = createTestApp()
    db.prepare("INSERT INTO settings (key, value) VALUES ('ablationRuns', '\"many\"'), ('baselineRuns', '{oops')").run()
    expect((await call(app, 'GET')).body).toMatchObject({ ablationRuns: 3, baselineRuns: 3 })
  })
})
