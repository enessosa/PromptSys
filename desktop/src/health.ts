export type WaitForHealthOptions = {
  /** Full URL, e.g. `http://127.0.0.1:47800/api/health`. */
  url: string
  timeoutMs?: number
  intervalMs?: number
  /** Return false to stop waiting early (the backend process has exited). */
  isAlive?: () => boolean
  fetchFn?: (url: string) => Promise<{ ok: boolean }>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Polls the health URL until it answers 2xx. Resolves true if healthy, false on timeout or when `isAlive` turns false. */
export async function waitForHealth(options: WaitForHealthOptions): Promise<boolean> {
  const {
    url,
    timeoutMs = 30_000,
    intervalMs = 200,
    isAlive = () => true,
    fetchFn = (u) => fetch(u, { signal: AbortSignal.timeout(2000) }),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options
  const deadline = now() + timeoutMs
  while (isAlive() && now() < deadline) {
    try {
      if ((await fetchFn(url)).ok) return true
    } catch {
      // not listening yet
    }
    await sleep(intervalMs)
  }
  return false
}
