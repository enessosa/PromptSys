/** Origin of the local backend, e.g. `http://127.0.0.1:47800`. */
export const originOf = (port: number): string => `http://127.0.0.1:${port}`

/** True for URLs the main window may load: the backend origin only. */
export function isAppUrl(url: string, port: number): boolean {
  try {
    return new URL(url).origin === originOf(port)
  } catch {
    return false
  }
}

/** True for links that may be handed to the default browser (never `file:`, `javascript:` and the like). */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** Requests the app session lets through: the backend (HTTP and WebSocket), our own local pages and in-memory data. */
export function isAllowedRequest(url: string, port: number): boolean {
  try {
    const u = new URL(url)
    if (u.origin === originOf(port)) return true
    return ['file:', 'data:', 'blob:', 'devtools:'].includes(u.protocol)
  } catch {
    return false
  }
}
