import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspace } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders, sampleCards, sseEvent, type Handler } from '../../test/utils.tsx'
import { ChatView } from './ChatView.tsx'

const initial = useWorkspace.getState()

const card = (id: number, state = 'included') => ({
  cardId: id,
  state,
  version: 1,
  position: id,
  title: sampleCards[id - 1]?.title ?? `Card ${id}`,
  kind: 'note',
  excerpt: '',
})

const preview = (cards: ReturnType<typeof card>[]) => ({
  cards,
  estimatedInputTokens: 120,
  droppedCardIds: [],
  prompt: { system: 'SYSTEM TEXT', messages: [{ role: 'user', content: 'hello' }] },
})

const conversation = { id: 1, title: 'Field rules', model: null, activeTimelineId: 10 }

const userMsg = (context = [card(1), card(2)]) => ({
  id: 1, parentId: null, role: 'user', content: 'What is required?', status: 'complete', replayOfId: null, model: null, errorCode: null,
  createdAt: '', context, citations: [], usedCardIds: [], unusedCardIds: [], invalidMarkers: [],
})
const answerMsg = (over = {}) => ({
  id: 2, parentId: 1, role: 'assistant', content: 'The field is required [c1].', status: 'complete', replayOfId: null, model: 'm', errorCode: null,
  createdAt: '', context: null, citations: [{ cardId: 1, marker: '[c1]', start: 23, end: 27, valid: true }],
  usedCardIds: [1], unusedCardIds: [2], invalidMarkers: [], ...over,
})

function routes(extra: Record<string, Handler> = {}, messages: unknown[] | (() => unknown[]) = []) {
  return {
    'GET /api/health': { body: { status: 'ok', apiKeyConfigured: true } },
    'GET /api/conversations/1': { body: conversation },
    'GET /api/conversations/1/tree': { body: { timelines: [{ id: 10, conversationId: 1, name: 'main', parentTimelineId: null, changeSummary: null }], messages: [] } },
    'GET /api/timelines/10/messages': () => ({ body: typeof messages === 'function' ? messages() : messages }),
    'GET /api/cards': { body: sampleCards },
    'POST /api/conversations/1/context-preview': ({ body }: { body: unknown }) => {
      const cards = (body as { cards?: { cardId: number; state: string }[] }).cards
      return { body: preview((cards ?? [{ cardId: 1, state: 'included' }, { cardId: 2, state: 'included' }]).map((c) => card(c.cardId, c.state))) }
    },
    ...extra,
  } as Record<string, Handler>
}

describe('ChatView', () => {
  beforeEach(() => useWorkspace.setState({ ...initial, chatContexts: {}, lastChatId: null, selectedMessageId: null }))
  afterEach(() => vi.unstubAllGlobals())

  it('streams an answer with a marker split across chunks, then shows the saved answer with the used/unused row', async () => {
    let sent = false
    const { calls } = mockFetch(
      routes(
        {
          'POST /api/timelines/10/messages': () => {
            sent = true
            const all =
              sseEvent('message_start', { userMessageId: 1, assistantMessageId: 2, timelineId: 10, cards: [], droppedCardIds: [] }) +
              sseEvent('text_delta', { text: 'The field is required ' }) +
              sseEvent('text_delta', { text: '[c1]' }) +
              sseEvent('citation', { cardId: 1, marker: '[c1]', start: 23, end: 27, valid: true }) +
              sseEvent('text_delta', { text: '.' }) +
              sseEvent('message_stop', { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, usedCardIds: [1], unusedCardIds: [2], invalidMarkers: [] })
            // split in the middle of an event name and of a JSON line
            const cut1 = all.indexOf('text_delta') + 4
            const cut2 = all.indexOf('"[c1]"') + 3
            return { sse: [all.slice(0, cut1), all.slice(cut1, cut2), all.slice(cut2)] }
          },
        },
        () => (sent ? [userMsg(), answerMsg()] : []),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<ChatView conversationId={1} />)
    await screen.findByText('Ask something')
    await screen.findByLabelText('Pin c1')

    await user.type(screen.getByLabelText('Message'), 'What is required?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const answer = await screen.findByLabelText('Cards of this answer')
    expect(answer).toHaveTextContent('used')
    expect(screen.getByLabelText('Answer')).toHaveTextContent('The field is required')
    expect(screen.getAllByRole('button', { name: 'Open [c1]' }).length).toBeGreaterThan(0)
    expect(screen.getByText('cited by the model')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')

    const post = calls.find((c) => c.key === 'POST /api/timelines/10/messages')!
    expect(post.body).toEqual({
      content: 'What is required?',
      cards: [{ cardId: 1, state: 'included' }, { cardId: 2, state: 'included' }],
    })
  })

  it('stops a running answer through the stop endpoint of the assistant message', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
    const enc = new TextEncoder()
    const { calls } = mockFetch(
      routes({
        'POST /api/timelines/10/messages': { stream },
        'POST /api/messages/2/stop': () => {
          controller.close()
          return { status: 204 }
        },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ChatView conversationId={1} />)
    await screen.findByLabelText('Pin c1')
    await user.type(screen.getByLabelText('Message'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    controller.enqueue(enc.encode(sseEvent('message_start', { userMessageId: 1, assistantMessageId: 2, timelineId: 10, cards: [], droppedCardIds: [] })))
    controller.enqueue(enc.encode(sseEvent('text_delta', { text: 'Partial text' })))
    expect(await screen.findByText('Partial text')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/messages/2/stop')).toBe(true))
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('shows the no-API-key state on 424 and keeps the typed text', async () => {
    mockFetch(
      routes({
        'POST /api/timelines/10/messages': { status: 424, body: { error: { code: 'api_key_missing', message: 'No API key', requestId: 'x' } } },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ChatView conversationId={1} />)
    await screen.findByLabelText('Pin c1')
    await user.type(screen.getByLabelText('Message'), 'Keep me')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No API key configured')
    expect(screen.getByLabelText('Message')).toHaveValue('Keep me')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('shows the no-API-key banner from the health check and disables sending', async () => {
    mockFetch(routes({ 'GET /api/health': { body: { status: 'ok', apiKeyConfigured: false } } }))
    renderWithProviders(<ChatView conversationId={1} />)
    expect(await screen.findByText(/No API key configured/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('sends the complete card state in tray order after pin, exclude, remove and add', async () => {
    const { calls } = mockFetch(
      routes({
        'POST /api/timelines/10/messages': { status: 424, body: { error: { code: 'api_key_missing', message: 'x' } } },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ChatView conversationId={1} />)
    await screen.findByLabelText('Pin c1')
    await user.click(screen.getByLabelText('Pin c1'))
    await user.click(screen.getByLabelText('Exclude c2'))
    await user.click(screen.getByLabelText('Add card to context'))
    await user.click(await screen.findByRole('button', { name: /c3\s*Gamma/ }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(await screen.findByLabelText('Remove c1'))
    await user.click(screen.getByLabelText('Pin c3'))
    // userEvent cannot focus the textarea right after the Primer dialog closed (its focus trap lingers in jsdom)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Q' } })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/timelines/10/messages')).toBe(true))
    expect(calls.find((c) => c.key === 'POST /api/timelines/10/messages')!.body).toEqual({
      content: 'Q',
      cards: [{ cardId: 2, state: 'excluded' }, { cardId: 3, state: 'pinned' }],
    })
  })

  it('shows the token estimate, dropped-card warning and the assembled prompt', async () => {
    mockFetch(
      routes({
        'POST /api/conversations/1/context-preview': () => ({ body: { ...preview([card(1), card(2)]), droppedCardIds: [2] } }),
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<ChatView conversationId={1} />)
    expect(await screen.findByText(/Over the token budget, not sent: c2/)).toBeInTheDocument()
    expect(screen.getByLabelText('Token estimate')).toHaveTextContent('~120')
    await user.click(screen.getByRole('button', { name: 'Show prompt' }))
    expect(await screen.findByText('SYSTEM TEXT')).toBeInTheDocument()
  })

  it('regenerates without the chosen cards', async () => {
    const { calls } = mockFetch(
      routes(
        {
          'POST /api/messages/2/regenerate': () => ({
            sse: [
              sseEvent('message_start', { userMessageId: 3, assistantMessageId: 4, timelineId: 11, cards: [], droppedCardIds: [] }),
              sseEvent('text_delta', { text: 'New answer' }),
              sseEvent('message_stop', { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, usedCardIds: [], unusedCardIds: [], invalidMarkers: [] }),
            ],
          }),
        },
        [userMsg(), answerMsg()],
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<ChatView conversationId={1} />)
    await user.click(await screen.findByRole('button', { name: /Regenerate without cards/ }))
    await user.click(await screen.findByLabelText('Leave out c2'))
    await user.click(screen.getByRole('button', { name: 'Regenerate without 1 card' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/messages/2/regenerate')).toBe(true))
    expect(calls.find((c) => c.key === 'POST /api/messages/2/regenerate')!.body).toEqual({ excludeCardIds: [2] })
    // the conversation is reloaded to pick up the new active timeline
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /api/conversations/1').length).toBeGreaterThan(1))
  })

  it('marks stopped and failed answers as partial', async () => {
    mockFetch(routes({}, [userMsg(), answerMsg({ status: 'error', errorCode: 'llm_rate_limited' })]))
    renderWithProviders(<ChatView conversationId={1} />)
    expect(await screen.findByText(/rate limit was reached/)).toBeInTheDocument()
  })
})
