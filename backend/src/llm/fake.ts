// Deterministic stand-ins for the Claude API and the embedding model, used by the end-to-end tests
// (`PROMPTSYS_FAKE_LLM=1`). Never active in production, see `fakeModeEnabled`.
import type { Embedder } from '../ablation/embedding.ts'
import type { LlmClient, LlmRequest, LlmStreamEvent } from './index.ts'

/** A message containing this word makes the fake reply long and slow, so a test can press "Stop". */
export const LONG_TRIGGER = 'long'

const CHUNK_DELAY_MS = 15
const LONG_CHUNKS = 400
const LONG_CHUNK_DELAY_MS = 50

/**
 * Decides whether the fake mode may run: only when the flag is set and `NODE_ENV` is not `production`.
 * In production the flag is ignored and an error is logged, so a stray variable can never replace the real API.
 */
export function fakeModeEnabled(
  flag: boolean,
  nodeEnv: string | undefined,
  logError: (message: string) => void = console.error,
): boolean {
  if (!flag) return false
  if (nodeEnv === 'production') {
    logError('PROMPTSYS_FAKE_LLM is set but NODE_ENV=production: the fake LLM is ignored.')
    return false
  }
  return true
}

/** IDs of the cards in the prompt, in prompt order. */
export function cardIdsOf(system: string | undefined): number[] {
  return [...(system ?? '').matchAll(/<card id="c(\d+)"/g)].map((m) => Number(m[1]))
}

const lastQuestion = (request: LlmRequest) => request.messages.findLast((m) => m.role === 'user')?.content ?? ''

/** The reply as chunks; the first card of the prompt is cited as `[cN]`, the marker split across two chunks. */
export function fakeChunks(request: LlmRequest): string[] {
  const [first] = cardIdsOf(request.system)
  if (lastQuestion(request).toLowerCase().includes(LONG_TRIGGER)) {
    const head = first === undefined ? [] : [`Long answer based on [c`, `${first}]. `]
    return [...head, ...Array.from({ length: LONG_CHUNKS }, (_, i) => `Sentence ${i + 1} of the long fake answer. `)]
  }
  if (first === undefined) return ['This is a fake answer ', 'without any card.']
  return ['This is a fake answer based on the card [c', `${first}]`, ' that you sent.']
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

const words = (text: string) => text.trim().split(/\s+/).length

/** A Claude client with fixed outputs: streamed answers cite the first sent card; ablation and rules calls are deterministic. */
export function createFakeLlm(): LlmClient {
  return {
    model: 'fake-model',
    async complete(request) {
      // Ablation: what the answer says depends on which cards are in the prompt, so a card can change it.
      const ids = cardIdsOf(request.system)
      const text = `Fake ablation answer using ${ids.length === 0 ? 'no cards' : ids.map((id) => `card c${id}`).join(' and ')}.`
      return { text, inputTokens: words(request.system ?? ''), outputTokens: words(text) }
    },
    async callTool(request) {
      // The rules prompt lists the cards as `<card id="c3" title=…>` in the user message.
      const [first] = cardIdsOf(request.messages.map((m) => m.content).join('\n'))
      const rules = first === undefined ? [] : [{ text: 'Fake rule taken from the first card.', source: { kind: 'card', cardId: first } }]
      return { input: { rules } }
    },
    async *stream(request, signal): AsyncGenerator<LlmStreamEvent> {
      const long = lastQuestion(request).toLowerCase().includes(LONG_TRIGGER)
      let text = ''
      for (const chunk of fakeChunks(request)) {
        await sleep(long ? LONG_CHUNK_DELAY_MS : CHUNK_DELAY_MS, signal)
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        text += chunk
        yield { type: 'text', text: chunk }
      }
      yield { type: 'done', stopReason: 'end_turn', inputTokens: words(request.system ?? ''), outputTokens: words(text) }
    },
  }
}

/** A hashed bag-of-words embedder (64 dimensions, unit length): no model download, same texts give cosine 1. */
export function createFakeEmbedder(): Embedder {
  return {
    async embed(texts) {
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
