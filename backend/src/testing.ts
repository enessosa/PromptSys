// Helpers for tests only: an app on a fresh in-memory database and a stub for the Claude client.
import type { Embedder } from './ablation/embedding.ts'
import { createApp } from './app.ts'
import { estimateTokens } from './assembly/index.ts'
import { migrate, openDatabase } from './db/index.ts'
import type { LlmClient, LlmRequest, LlmStreamEvent } from './llm/index.ts'

/** What the stub answers: a text, a list of stream chunks (e.g. `['see [c', '3]']`) or a script that streams chunks itself. */
export type StubReply =
  | string
  | string[]
  | ((request: LlmRequest, signal: AbortSignal) => AsyncIterable<string>)
  /** What `callTool` returns as the tool input (any value, also malformed ones); a plain text reply means "no tool call". */
  | { toolInput: unknown }

export type StubLlm = LlmClient & { requests: LlmRequest[] }

const chunksOf = (reply: StubReply | undefined, request: LlmRequest, signal: AbortSignal): AsyncIterable<string> => {
  if (typeof reply === 'function') return reply(request, signal)
  const chunks = reply === undefined || (typeof reply === 'object' && !Array.isArray(reply)) ? [''] : typeof reply === 'string' ? [reply] : reply
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })()
}

/**
 * A Claude client that answers with fixed replies (in order, the last one repeats) and records every request.
 * `complete` joins the chunks; `stream` yields them one by one, stops with an error when the signal is aborted
 * and ends with a `done` event (`end_turn`, token usage estimated from the text).
 */
export function createStubLlm(...replies: StubReply[]): StubLlm {
  const requests: LlmRequest[] = []
  const next = (request: LlmRequest) => {
    requests.push(request)
    return replies[Math.min(requests.length - 1, replies.length - 1)]
  }
  return {
    requests,
    model: 'stub-model',
    async complete(request) {
      const chunks: string[] = []
      for await (const chunk of chunksOf(next(request), request, new AbortController().signal)) chunks.push(chunk)
      return { text: chunks.join('') }
    },
    async callTool(request) {
      const reply = next(request)
      return { input: typeof reply === 'object' && !Array.isArray(reply) && 'toolInput' in reply ? reply.toolInput : null }
    },
    async *stream(request, signal): AsyncGenerator<LlmStreamEvent> {
      let text = ''
      for await (const chunk of chunksOf(next(request), request, signal)) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        text += chunk
        yield { type: 'text', text: chunk }
      }
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const input = estimateTokens(request.system ?? '') + request.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
      yield { type: 'done', stopReason: 'end_turn', inputTokens: input, outputTokens: estimateTokens(text) }
    },
  }
}

/**
 * A deterministic embedder without a model: a hashed bag of words (64 dimensions, unit length), so equal texts give
 * cosine 1 and texts with different words give lower values. `calls` records every batch.
 */
export function createFakeEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    async embed(texts) {
      calls.push(texts)
      return texts.map((text) => {
        const v = new Array<number>(64).fill(0)
        for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          let h = 0
          for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0
          v[h % 64] += 1
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
        return v.map((x) => x / norm)
      })
    },
  }
}

/** A new app with an in-memory SQLite database (all migrations applied), by default a stub LLM (`null`: no API key) and the fake embedder. */
export function createTestApp(llm: LlmClient | null = createStubLlm('stub answer'), embedder: Embedder = createFakeEmbedder()) {
  const db = openDatabase(':memory:')
  migrate(db)
  return { app: createApp({ db, llm: llm ?? undefined, embedder }), db, llm, embedder }
}
