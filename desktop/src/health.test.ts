import { describe, expect, it } from 'vitest'
import { waitForHealth } from './health'

/** Fake clock: `sleep` advances time, so no real waiting. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

describe('waitForHealth', () => {
  it('resolves true once the endpoint answers', async () => {
    let calls = 0
    const ok = await waitForHealth({
      url: 'http://x/api/health',
      ...clock(),
      fetchFn: async () => {
        if (++calls < 3) throw new Error('ECONNREFUSED')
        return { ok: true }
      },
    })
    expect(ok).toBe(true)
    expect(calls).toBe(3)
  })

  it('keeps waiting on non-2xx answers and times out', async () => {
    const ok = await waitForHealth({ url: 'u', timeoutMs: 1000, intervalMs: 100, ...clock(), fetchFn: async () => ({ ok: false }) })
    expect(ok).toBe(false)
  })

  it('stops early when the process is gone', async () => {
    let calls = 0
    const ok = await waitForHealth({
      url: 'u',
      ...clock(),
      isAlive: () => calls < 2,
      fetchFn: async () => {
        calls++
        return { ok: false }
      },
    })
    expect(ok).toBe(false)
    expect(calls).toBe(2)
  })
})
