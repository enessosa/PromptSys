import type { ReactElement } from 'react'
import { ThemeProvider } from '@primer/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    client,
    ...render(
      <ThemeProvider colorMode="night">
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </ThemeProvider>,
    ),
  }
}

export type MockResponse = {
  status?: number
  body?: unknown
  /** Text/event-stream answer: the chunks are delivered one by one (they may split events anywhere). */
  sse?: string[]
  /** Open stream the test controls itself (e.g. to click Stop while an answer is running). */
  stream?: ReadableStream<Uint8Array>
}

/** Formats one SSE event. */
export const sseEvent = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
export type Handler = MockResponse | ((req: { url: URL; body: unknown }) => MockResponse)

/** Replaces `fetch` with a router keyed by "METHOD /path"; unknown routes answer 404 with an error envelope. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ key, body })
    const handler = routes[key]
    const res: MockResponse = handler
      ? typeof handler === 'function'
        ? handler({ url, body })
        : handler
      : { status: 404, body: { error: { code: 'not_found', message: `No mock for ${key}` } } }
    const status = res.status ?? 200
    if (res.sse || res.stream) {
      const enc = new TextEncoder()
      const stream =
        res.stream ??
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of res.sse ?? []) controller.enqueue(enc.encode(chunk))
            controller.close()
          },
        })
      return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? null), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export const sampleCards = [
  { id: 1, title: 'Alpha rules', excerpt: 'a', kind: 'rule', folderPath: 'project/api', defaultIncluded: false, version: 1, mergedInto: null, archivedAt: null, createdAt: '', updatedAt: '' },
  { id: 2, title: 'Beta notes', excerpt: 'b', kind: 'note', folderPath: 'project', defaultIncluded: false, version: 1, mergedInto: null, archivedAt: null, createdAt: '', updatedAt: '' },
  { id: 3, title: 'Gamma', excerpt: 'c', kind: 'memory', folderPath: '', defaultIncluded: true, version: 2, mergedInto: null, archivedAt: null, createdAt: '', updatedAt: '' },
]
