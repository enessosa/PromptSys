const ERROR_TEXT: Record<string, string> = {
  llm_rate_limited: 'The API rate limit was reached.',
  llm_timeout: 'The model took too long to answer.',
  llm_error: 'The model API returned an error.',
  interrupted: 'The answer was interrupted (the backend restarted).',
  replay_active: 'A replay is active on this timeline. Branch off or cancel it before chatting freely.',
  replay_not_active: 'This replay is no longer active.',
  generation_running: 'An answer is already being generated on this timeline.',
  internal_error: 'Something went wrong in the backend.',
}

export function errorText(code: string | null): string {
  return (code && ERROR_TEXT[code]) || (code ? `Error: ${code}` : 'The answer failed.')
}

/** Friendly text for known codes, otherwise the backend's own message. */
export function failureText(code: string, message: string): string {
  return ERROR_TEXT[code] ?? message
}
