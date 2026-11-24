import type { ErrorDetail, ErrorEnvelope } from './types.ts'

/** Error with the fields of the backend error envelope; `status` 0 means the request never got an answer. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ErrorDetail[] | null
  readonly requestId: string | null

  constructor(status: number, code: string, message: string, details?: ErrorDetail[] | null, requestId?: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details ?? null
    this.requestId = requestId ?? null
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Multipart body (file upload); the browser sets the content type. */
  form?: FormData
  query?: Query
  signal?: AbortSignal
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

function isEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const err = (value as { error: unknown }).error
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
}

/** Turns a non-2xx response into an ApiError, using the envelope when the body has one. */
export async function toApiError(res: Response): Promise<ApiError> {
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // not JSON (e.g. a proxy error page)
  }
  if (isEnvelope(data)) {
    const e = data.error
    return new ApiError(res.status, e.code, e.message, e.details, e.requestId)
  }
  return new ApiError(res.status, `http_${res.status}`, res.statusText || `Request failed (${res.status})`)
}

/** Single place for request headers (add an auth token here if a login ever exists). */
export function requestInit(opts: RequestOptions): RequestInit {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  return {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  }
}

export async function api<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), requestInit(opts))
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'network_error', 'The backend is not reachable.')
  }
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** The API cannot be reached at all (no answer, or the Vite proxy reports a dead backend). */
export function isBackendDown(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504)
}
