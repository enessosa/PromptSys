import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isPortFree, pickPort } from './ports'

describe('pickPort', () => {
  it('takes the preferred port when it is free', async () => {
    expect(await pickPort(47800, async () => true)).toBe(47800)
  })

  it('scans upward when ports are taken', async () => {
    const taken = new Set([47800, 47801])
    expect(await pickPort(47800, async (p) => !taken.has(p))).toBe(47802)
  })

  it('falls back to a random port when the whole range is taken', async () => {
    expect(await pickPort(47800, async () => false, async () => 53211)).toBe(53211)
  })

  it('isPortFree sees a port that is in use', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    expect(await isPortFree(port)).toBe(false)
    await new Promise((resolve) => server.close(resolve))
    expect(await isPortFree(port)).toBe(true)
  })
})
