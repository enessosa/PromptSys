import { describe, expect, it } from 'vitest'
import { loadSettings } from './config.ts'

describe('loadSettings', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadSettings({})).toEqual({
      port: 8000,
      dbUrl: 'promptsys.db',
      anthropicApiKey: undefined,
      anthropicModel: 'claude-opus-5-5',
      frontendDist: undefined,
      embeddingCacheDir: undefined,
      fakeLlm: false,
    })
  })

  it('reads and coerces values', () => {
    const s = loadSettings({ PORT: '9000', DB_URL: ':memory:', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' })
    expect(s).toMatchObject({ port: 9000, dbUrl: ':memory:', anthropicApiKey: 'k', anthropicModel: 'm' })
  })

  it('reads the frontend and embedding cache folders', () => {
    const s = loadSettings({ FRONTEND_DIST: '/app/dist', EMBEDDING_CACHE_DIR: '/data/models' })
    expect(s.frontendDist).toBe('/app/dist')
    expect(s.embeddingCacheDir).toBe('/data/models')
  })

  it('reads the fake LLM flag only for the value 1', () => {
    expect(loadSettings({ PROMPTSYS_FAKE_LLM: '1' }).fakeLlm).toBe(true)
    expect(loadSettings({ PROMPTSYS_FAKE_LLM: 'true' }).fakeLlm).toBe(false)
    expect(loadSettings({ PROMPTSYS_FAKE_LLM: '' }).fakeLlm).toBe(false)
  })

  it('treats empty strings as unset', () => {
    expect(loadSettings({ PORT: '', ANTHROPIC_API_KEY: '' }).port).toBe(8000)
    expect(loadSettings({ ANTHROPIC_API_KEY: '' }).anthropicApiKey).toBeUndefined()
  })

  it('rejects an invalid port', () => {
    expect(() => loadSettings({ PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadSettings({ PORT: '70000' })).toThrow(/PORT/)
  })
})
