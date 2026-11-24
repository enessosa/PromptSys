import type { DerivedRule } from '../../api/types.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import { sourceLabel } from './model.ts'
import { RulesPanel } from './RulesPanel.tsx'

const rule = (over = {}): DerivedRule => ({
  id: 1, conversationId: 1, messageId: 5, text: 'Fields must be validated.', status: 'proposed' as const,
  source: { kind: 'card' as const, cardId: 2, reliability: 'claimed' as const }, cardId: null, createdAt: '', ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('sourceLabel', () => {
  it('labels claimed sources', () => {
    expect(sourceLabel(rule())).toBe('card c2 (claimed)')
    expect(sourceLabel(rule({ source: { kind: 'prior_knowledge', cardId: null, reliability: 'claimed' } }))).toBe('prior knowledge (claimed)')
  })
})

describe('RulesPanel', () => {
  it('lists the rules of one answer with their source', async () => {
    mockFetch({ 'GET /api/conversations/1/rules': { body: [rule(), rule({ id: 2, messageId: 9, text: 'Other answer' })] } })
    renderWithProviders(<RulesPanel conversationId={1} messageId={5} />)
    expect(await screen.findByText('Fields must be validated.')).toBeInTheDocument()
    expect(screen.getByText('card c2 (claimed)')).toBeInTheDocument()
    expect(screen.queryByText('Other answer')).not.toBeInTheDocument()
  })

  it('says so when the model stated no rules', async () => {
    mockFetch({ 'GET /api/conversations/1/rules': { body: [] } })
    renderWithProviders(<RulesPanel conversationId={1} messageId={5} />)
    expect(await screen.findByText(/No rules requested|stated no rules/)).toBeInTheDocument()
  })

  it('confirms, rejects and saves a confirmed rule as a card', async () => {
    const { calls } = mockFetch({
      'GET /api/conversations/1/rules': { body: [rule(), rule({ id: 2, text: 'Second', status: 'confirmed' })] },
      'PATCH /api/rules/1': { body: { rule: rule({ status: 'confirmed' }) } },
      'PATCH /api/rules/2': { body: { rule: rule({ id: 2, status: 'rejected' }) } },
      'POST /api/rules/2/card': { status: 201, body: { rule: rule({ id: 2, cardId: 9 }), card: { id: 9 } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<RulesPanel conversationId={1} />)
    await screen.findByText('Second')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await user.click(screen.getByRole('button', { name: 'Save as card' }))
    const rejects = screen.getAllByRole('button', { name: 'Reject' })
    await user.click(rejects[1])
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/rules/2')).toBe(true))
    expect(calls.find((c) => c.key === 'PATCH /api/rules/1')?.body).toEqual({ status: 'confirmed' })
    expect(calls.some((c) => c.key === 'POST /api/rules/2/card')).toBe(true)
    expect(calls.find((c) => c.key === 'PATCH /api/rules/2')?.body).toEqual({ status: 'rejected' })
  })

  it('corrects a rule inline and links to the new rule card', async () => {
    let corrected = false
    const { calls } = mockFetch({
      'GET /api/conversations/1/rules': () => ({ body: [corrected ? rule({ status: 'corrected', text: 'Fields are always validated.', cardId: 12 }) : rule()] }),
      'PATCH /api/rules/1': () => {
        corrected = true
        return { body: { rule: rule({ status: 'corrected', cardId: 12 }), card: { id: 12 } } }
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<RulesPanel conversationId={1} messageId={5} />)
    await user.click(await screen.findByRole('button', { name: 'Correct' }))
    const box = screen.getByLabelText('Corrected rule')
    await user.clear(box)
    await user.type(box, 'Fields are always validated.')
    await user.click(screen.getByRole('button', { name: 'Save as rule card' }))
    expect(await screen.findByRole('button', { name: /Rule card c12/ })).toBeInTheDocument()
    expect(calls.find((c) => c.key === 'PATCH /api/rules/1')?.body).toEqual({ status: 'corrected', text: 'Fields are always validated.' })
  })
})
