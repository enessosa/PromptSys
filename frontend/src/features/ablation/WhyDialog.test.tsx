import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockFetch, renderWithProviders, sseEvent } from '../../test/utils.tsx'
import { WhyDialog } from './WhyDialog.tsx'

const target = {
  messageId: 7,
  answerText: 'Original answer [c1].',
  cards: [{ cardId: 1, title: 'Alpha rules' }, { cardId: 2, title: 'Beta notes' }],
  cardId: 1,
}
const dry = { messageId: 7, cardIds: [1], runs: 3, baselineRuns: 3, reusedBaselineRuns: 0, estimatedApiCalls: 6 }
const result = {
  cardId: 1, runs: 3, change: 0.31, noise: 0.05, noiseMeasured: true, effect: 0.26, label: 'strong',
  explanation: 'The answer changes clearly without this card.',
  answers: [{ runIndex: 0, answer: 'Ablated answer.', similarity: 0.69 }],
}
const settings = { defaultModel: null, ablationRuns: 3, baselineRuns: 3, ablationTemperature: 0.2, accentColor: null }

afterEach(() => vi.unstubAllGlobals())

describe('WhyDialog', () => {
  it('estimates calls, asks for confirmation, shows progress and then the result', async () => {
    const enc = new TextEncoder()
    let ctl!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) })
    const { calls } = mockFetch({
      'GET /api/settings': { body: settings },
      'GET /api/messages/7/ablations': { body: { messageId: 7, baseline: { runs: 3, noise: 0.05, answers: [] }, cards: [] } },
      'POST /api/messages/7/ablations': ({ body }) => ((body as { dryRun?: boolean }).dryRun ? { body: dry } : { stream }),
    })
    const user = userEvent.setup()
    renderWithProviders(<WhyDialog target={target} onClose={() => {}} />)

    // default: only the clicked card is selected
    expect(screen.getByLabelText('Ask about c1')).toBeChecked()
    expect(screen.getByLabelText('Ask about c2')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Estimate API calls' }))

    expect(await screen.findByText(/3 \+ 3 × 1 = 6 API calls/)).toBeInTheDocument()
    expect(calls.filter((c) => c.key === 'POST /api/messages/7/ablations' && (c.body as { dryRun?: boolean }).dryRun)).toHaveLength(1)
    // nothing is run before the confirmation
    expect(calls.filter((c) => c.key === 'POST /api/messages/7/ablations')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Run 6 API calls' }))
    ctl.enqueue(enc.encode(sseEvent('progress', { done: 2, total: 6 })))
    expect(await screen.findByText('2 of 6 API calls done')).toBeInTheDocument()

    ctl.enqueue(enc.encode(sseEvent('ablation_result', result) + sseEvent('message_stop', { messageId: 7, apiCalls: 6 })))
    ctl.close()

    expect(await screen.findByText('The answer changes clearly without this card.')).toBeInTheDocument()
    expect(screen.getByText('strong')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Effect' })).toHaveAttribute('aria-valuenow', '0.26')
    expect(screen.getByText(/Baseline noise: 0.05/)).toBeInTheDocument()
    expect(screen.getByText(/Original vs. answer without c1/)).toBeInTheDocument()
    const run = calls.find((c) => c.key === 'POST /api/messages/7/ablations' && !(c.body as { dryRun?: boolean }).dryRun)
    expect(run?.body).toEqual({ cardIds: [1], runs: 3, baselineRuns: 3 })
  })

  it('shows earlier results with the single-run hint and the within-noise label', async () => {
    mockFetch({
      'GET /api/settings': { body: settings },
      'GET /api/messages/7/ablations': {
        body: { messageId: 7, baseline: { runs: 0, noise: null, answers: [] }, cards: [{ ...result, runs: 1, effect: 0, label: 'within_noise', noiseMeasured: false, explanation: 'No effect: card not needed or model already knew it.' }] },
      },
    })
    renderWithProviders(<WhyDialog target={target} onClose={() => {}} />)
    expect(await screen.findByText('within noise')).toBeInTheDocument()
    expect(screen.getByText('Single run, may be noise.')).toBeInTheDocument()
    expect(screen.getByText(/No baseline noise measured/)).toBeInTheDocument()
  })

  it('explains a missing API key (424) and sends nothing else', async () => {
    const { calls } = mockFetch({
      'GET /api/settings': { body: settings },
      'GET /api/messages/7/ablations': { body: { messageId: 7, baseline: { runs: 0, noise: null, answers: [] }, cards: [] } },
      'POST /api/messages/7/ablations': { status: 424, body: { error: { code: 'api_key_missing', message: 'no key' } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<WhyDialog target={target} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Estimate API calls' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY')
    await waitFor(() => expect(calls.filter((c) => c.key === 'POST /api/messages/7/ablations')).toHaveLength(1))
  })

  it('shows a 409 as "already running"', async () => {
    mockFetch({
      'GET /api/settings': { body: settings },
      'GET /api/messages/7/ablations': { body: { messageId: 7, baseline: { runs: 0, noise: null, answers: [] }, cards: [] } },
      'POST /api/messages/7/ablations': { status: 409, body: { error: { code: 'generation_running', message: 'busy' } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<WhyDialog target={target} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Estimate API calls' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already running')
  })
})
