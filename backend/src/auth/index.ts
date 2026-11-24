// Protection of the local API: Host/Origin check (no login and no JWT in v1, see "Security" in docs/phases/3. Draft.md).
import type { MiddlewareHandler } from 'hono'
import { AppError } from '../common/errors.ts'

/** Port of the Vite dev server; the browser talks to the API through its proxy in development. */
export const VITE_DEV_PORT = 5173

export type OriginGuardOptions = {
  /** The port the backend listens on. */
  port: number
  /** Also accepts the Vite dev server (`localhost:5173`, `127.0.0.1:5173`). */
  development: boolean
}

/**
 * Rejects requests with `403 forbidden_origin` that could come from a web page of another site
 * (CSRF, DNS rebinding): the `Host` header must name the local server, and an `Origin` header, if present,
 * must be the app's own origin. Requests without `Origin` (curl, same-origin GET, other programs) pass.
 */
export function originGuard({ port, development }: OriginGuardOptions): MiddlewareHandler {
  const ports = development ? [port, VITE_DEV_PORT] : [port]
  const hosts = new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]))
  const origins = new Set([...hosts].map((h) => `http://${h}`))
  return async (c, next) => {
    const host = c.req.header('host')?.toLowerCase()
    if (host === undefined || !hosts.has(host)) {
      throw new AppError(403, 'forbidden_origin', 'This host is not allowed to use the PromptSys API.')
    }
    const origin = c.req.header('origin')
    if (origin !== undefined && !origins.has(origin.toLowerCase())) {
      throw new AppError(403, 'forbidden_origin', 'This origin is not allowed to use the PromptSys API.')
    }
    await next()
  }
}
