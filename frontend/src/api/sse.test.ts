import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client.ts'
import { eventJson, SseParser, streamSse } from './sse.ts'

const wire =
  'event: message_start\ndata: {"id":1}\n\n: ping\n\nevent: text_delta\ndata: {"text":"Hi"}\n\nevent: message_stop\ndata: {"stopReason":"end_turn"}\n\n'

describe('SseParser', () => {
  it('parses complete events and ignores comment lines', () => {
    const events = new SseParser().push(wire)
    expect(events.map((e) => e.event)).toEqual(['message_start', 'text_delta', 'message_stop'])
    expect(eventJson<{ text: string }>(events[1])).toEqual({ text: 'Hi' })
  })

  it('gives the same result when the stream is split at every possible position', () => {
    const expected = new SseParser().push(wire)
    for (let i = 1; i < wire.length; i++) {
      const parser = new SseParser()
      const got = [...parser.push(wire.slice(0, i)), ...parser.push(wire.slice(i)), ...parser.flush()]
      expect(got).toEqual(expected)
    }
  })

  it('handles CRLF, also when CR and LF arrive in different chunks', () => {
    const parser = new SseParser()
    const got = [...parser.push('event: a\r'), ...parser.push('\ndata: 1\r\n\r'), ...parser.push('\n')]
    expect(got).toEqual([{ event: 'a', data: '1' }])
  })

  it('joins multiple data lines and defaults the event name to "message"', () => {
    expect(new SseParser().push('data: one\ndata: two\n\n')).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })

  it('does not dispatch events without data and flushes an unterminated last event', () => {
    const parser = new SseParser()
    expect(parser.push('event: x\n\n')).toEqual([])
    expect(parser.push('event: y\ndata: z')).toEqual([])
    expect(parser.flush()).toEqual([{ event: 'y', data: 'z' }])
  })
})

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(enc.encode(c)))
      controller.close()
    },
  })
}

describe('streamSse', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the body and yields events across chunk boundaries', async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf([wire.slice(0, 20), wire.slice(20)]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out: string[] = []
    for await (const ev of streamSse('/api/timelines/1/messages', { body: { content: 'hi' } })) out.push(ev.event)
    expect(out).toEqual(['message_start', 'text_delta', 'message_stop'])
    const init = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"content":"hi"}')
  })

  it('throws an ApiError for a non-2xx answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'api_key_missing', message: 'No key' } }), { status: 424 })),
    )
    const run = async () => {
      for await (const ev of streamSse('/x', { body: {} })) void ev
    }
    await expect(run()).rejects.toMatchObject({ code: 'api_key_missing', status: 424 })
    await expect(run()).rejects.toBeInstanceOf(ApiError)
  })
})
