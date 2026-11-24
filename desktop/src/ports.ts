import { createServer } from 'node:net'

/** The port the backend asks for first. Fixed on purpose: `localStorage` (open tabs, sidebar width) belongs to the origin. */
export const PREFERRED_PORT = 47800
const SCAN_RANGE = 20

/** True if nothing listens on `127.0.0.1:port` (we bind it briefly to find out). */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host: '127.0.0.1' }, () => server.close(() => resolve(true)))
  })
}

/** Asks the OS for any free port on `127.0.0.1`. */
export function randomFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * The first free port from `preferred` up to `preferred + 19`; if all are taken, a random free one.
 * `isFree` and `random` are injectable for tests.
 */
export async function pickPort(
  preferred: number = PREFERRED_PORT,
  isFree: (port: number) => Promise<boolean> = isPortFree,
  random: () => Promise<number> = randomFreePort,
): Promise<number> {
  for (let port = preferred; port < preferred + SCAN_RANGE && port <= 65535; port++) {
    if (await isFree(port)) return port
  }
  return random()
}
