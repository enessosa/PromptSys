import type { Context } from 'hono'

/** Stable, machine-readable error codes (see "Error format" in docs/phases/3. Draft.md). */
export type ErrorCode =
  | 'validation_failed'
  | 'invalid_link'
  | 'not_found'
  | 'card_not_found'
  | 'link_not_found'
  | 'version_conflict'
  | 'link_exists'
  | 'card_archived'
  | 'card_merged'
  | 'invalid_merge'
  | 'merge_not_found'
  | 'merge_already_undone'
  | 'merge_outdated'
  | 'file_too_large'
  | 'unsupported_file_type'
  | 'forbidden_origin'
  | 'conversation_not_found'
  | 'message_not_found'
  | 'timeline_not_found'
  | 'generation_running'
  | 'replay_not_active'
  | 'replay_active'
  | 'api_key_missing'
  | 'feature_requires_claude_code_mode'
  | 'feature_requires_api_mode'
  | 'session_not_found'
  | 'session_busy'
  | 'card_rejected'
  | 'approval_not_found'
  | 'invalid_project_path'
  | 'llm_rate_limited'
  | 'llm_error'
  | 'llm_timeout'
  | 'internal_error'

export type ErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown; requestId: string }
}

/** An error that is sent to the client with the given HTTP status and error code. */
export type ErrorStatus = 400 | 403 | 404 | 409 | 413 | 422 | 424 | 429 | 502 | 504

export class AppError extends Error {
  status: ErrorStatus
  code: ErrorCode
  details?: unknown

  constructor(status: ErrorStatus, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Builds the error envelope; also used for `error` events inside SSE streams. */
export function errorBody(code: ErrorCode, message: string, requestId: string, details?: unknown): ErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }), requestId } }
}

/** Hono `onError` handler: one envelope for every error; unexpected errors become a 500 without internal details. */
export function handleError(err: Error, c: Context) {
  const requestId = crypto.randomUUID()
  if (err instanceof AppError) return c.json(errorBody(err.code, err.message, requestId, err.details), err.status)
  console.error(`[${requestId}]`, err)
  return c.json(errorBody('internal_error', 'Internal server error', requestId), 500)
}

/** Hono `notFound` handler for unknown routes, in the same envelope. */
export function handleNotFound(c: Context) {
  const message = `No route for ${c.req.method} ${new URL(c.req.url).pathname}`
  return c.json(errorBody('not_found', message, crypto.randomUUID()), 404)
}
