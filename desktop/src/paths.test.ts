import { describe, expect, it } from 'vitest'
import { isAllowedRequest, isAppUrl, isExternalHttpUrl } from './navigation'
import { backendEnv, dataPaths, resourcePaths } from './paths'

describe('paths', () => {
  it('uses the resources folder when packaged and the repository otherwise', () => {
    const packaged = resourcePaths({ packaged: true, resourcesPath: '/App/Resources', repoRoot: '/repo' })
    expect(packaged.backendEntry).toBe('/App/Resources/backend/dist/main.js')
    expect(packaged.frontendDist).toBe('/App/Resources/frontend')
    const dev = resourcePaths({ packaged: false, resourcesPath: '/x', repoRoot: '/repo' })
    expect(dev.backendEntry).toBe('/repo/backend/dist/main.js')
    expect(dev.frontendDist).toBe('/repo/frontend/dist')
  })

  it('builds the backend environment from an allowlist', () => {
    const env = backendEnv({
      port: 47800,
      paths: dataPaths('/data'),
      frontendDist: '/fe',
      apiKey: 'k',
      parentEnv: { PATH: '/bin', ANTHROPIC_API_KEY: 'stray', SECRET: 'x', PORT: '9' },
    })
    expect(env).toMatchObject({ NODE_ENV: 'production', PORT: '47800', DB_URL: '/data/promptsys.db', FRONTEND_DIST: '/fe', EMBEDDING_CACHE_DIR: '/data/models', PATH: '/bin', ANTHROPIC_API_KEY: 'k' })
    expect(env.SECRET).toBeUndefined()
  })

  it('does not pass a stray key from the parent environment', () => {
    const env = backendEnv({ port: 1, paths: dataPaths('/d'), frontendDist: '/f', apiKey: undefined, parentEnv: { ANTHROPIC_API_KEY: 'stray' } })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('navigation', () => {
  it('knows the app origin', () => {
    expect(isAppUrl('http://127.0.0.1:47800/chat/c1', 47800)).toBe(true)
    expect(isAppUrl('http://localhost:47800/', 47800)).toBe(false)
    expect(isAppUrl('http://127.0.0.1:8000/', 47800)).toBe(false)
    expect(isAppUrl('not a url', 47800)).toBe(false)
  })
  it('opens only http(s) links externally', () => {
    expect(isExternalHttpUrl('https://example.com')).toBe(true)
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false)
  })
  it('blocks remote requests', () => {
    expect(isAllowedRequest('http://127.0.0.1:47800/api/health', 47800)).toBe(true)
    expect(isAllowedRequest('file:///app/settings.html', 47800)).toBe(true)
    expect(isAllowedRequest('https://fonts.googleapis.com/css', 47800)).toBe(false)
  })
})
