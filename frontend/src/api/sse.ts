import { requestInit, toApiError, type RequestOptions } from './client.ts'

export type SseEvent = { event: string; data: string }

/**
 * Incremental parser for the text/event-stream format. Chunks may be split anywhere
 * (also inside a line or between CR and LF); comment lines (": ping") are ignored.
 */
export class SseParser {
  private buffer = ''
  private event = ''
  private data: string[] = []

  /** Feeds a chunk of text and returns all events completed by it. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const out: SseEvent[] = []
    for (;;) {
      const m = /\r\n|\n|\r/.exec(this.buffer)
      if (!m) break
      // A trailing lone CR may be the first half of CRLF: wait for the next chunk.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) break
      const line = this.buffer.slice(0, m.index)
      this.buffer = this.buffer.slice(m.index + m[0].length)
      const ev = this.line(line)
      if (ev) out.push(ev)
    }
    return out
  }

  /** Call at the end of the stream; dispatches an event that was not closed by a blank line. */
  flush(): SseEvent[] {
    const out: SseEvent[] = []
    if (this.buffer) {
      const ev = this.line(this.buffer.replace(/\r$/, ''))
      this.buffer = ''
      if (ev) out.push(ev)
    }
    const last = this.dispatch()
    if (last) out.push(last)
    return out
  }

  private line(line: string): SseEvent | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null
    const i = line.indexOf(':')
    const field = i === -1 ? line : line.slice(0, i)
    let value = i === -1 ? '' : line.slice(i + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.data.push(value)
    return null
  }

  private dispatch(): SseEvent | null {
    if (this.data.length === 0) {
      this.event = ''
      return null
    }
    const ev = { event: this.event || 'message', data: this.data.join('\n') }
    this.event = ''
    this.data = []
    return ev
  }
}

/** Parses the JSON payload of an event. */
export function eventJson<T>(ev: SseEvent): T {
  return JSON.parse(ev.data) as T
}

/** POSTs `body` and yields the events of the streamed answer; aborting `signal` stops the stream. */
export async function* streamSse(
  path: string,
  opts: Omit<RequestOptions, 'method'> = {},
): AsyncGenerator<SseEvent> {
  const res = await fetch(path, requestInit({ ...opts, method: 'POST' }))
  if (!res.ok) throw await toApiError(res)
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield* parser.push(decoder.decode(value, { stream: true }))
    }
    yield* parser.push(decoder.decode())
    yield* parser.flush()
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
