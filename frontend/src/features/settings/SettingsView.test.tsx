import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { mockFetch, renderWithProviders } from '../../test/utils.tsx'
import { SettingsView } from './SettingsView.tsx'
import { parseSettingsForm } from './settingsForm.ts'

const settings = { defaultModel: null, ablationRuns: 3, baselineRuns: 3, ablationTemperature: 0.2, accentColor: null }
const health = { 'GET /api/health': { body: { status: 'ok', apiKeyConfigured: false } } }

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.promptsys
  document.documentElement.style.removeProperty('--ps-accent')
})

describe('parseSettingsForm', () => {
  const form = { defaultModel: ' ', ablationRuns: '3', baselineRuns: '0', ablationTemperature: '0.5', accentColor: null }
  it('accepts valid values and turns an empty model into null', () => {
    expect(parseSettingsForm(form)).toEqual({ value: { defaultModel: null, ablationRuns: 3, baselineRuns: 0, ablationTemperature: 0.5, accentColor: null } })
  })
  it('rejects out of range values', () => {
    const r = parseSettingsForm({ ...form, ablationRuns: '11', baselineRuns: '1.5', ablationTemperature: '2' })
    expect('errors' in r && Object.keys(r.errors)).toEqual(['ablationRuns', 'baselineRuns', 'ablationTemperature'])
  })
})

describe('SettingsView', () => {
  it('saves changed values with PUT and applies the accent colour live', async () => {
    const { calls } = mockFetch({
      ...health,
      'GET /api/settings': { body: settings },
      'PUT /api/settings': ({ body }) => ({ body: { ...settings, ...(body as object) } }),
    })
    const user = userEvent.setup()
    renderWithProviders(<SettingsView />)
    const runs = await screen.findByLabelText(/Runs per card/)
    await user.clear(runs)
    await user.type(runs, '5')
    await user.type(screen.getByLabelText('Default model'), 'claude-test')
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#aa5500' } })
    expect(document.documentElement.style.getPropertyValue('--ps-accent')).toBe('#aa5500')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'PUT /api/settings')).toBe(true))
    expect(calls.find((c) => c.key === 'PUT /api/settings')?.body).toEqual({
      defaultModel: 'claude-test', ablationRuns: 5, baselineRuns: 3, ablationTemperature: 0.2, accentColor: '#aa5500',
    })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('does not save invalid values', async () => {
    const { calls } = mockFetch({ ...health, 'GET /api/settings': { body: settings } })
    const user = userEvent.setup()
    renderWithProviders(<SettingsView />)
    const runs = await screen.findByLabelText(/Runs per card/)
    await user.clear(runs)
    await user.type(runs, '99')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A whole number from 1 to 10.')).toBeInTheDocument()
    expect(calls.some((c) => c.key === 'PUT /api/settings')).toBe(false)
  })

  it('shows the backend/.env hint in a browser', async () => {
    mockFetch({ ...health, 'GET /api/settings': { body: settings } })
    renderWithProviders(<SettingsView />)
    expect(await screen.findByText(/ANTHROPIC_API_KEY in backend\/\.env/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claude API key…' })).not.toBeInTheDocument()
  })

  it('shows the key button in the desktop app and calls the bridge', async () => {
    const openSettings = vi.fn(async () => undefined)
    window.promptsys = { isDesktop: true, platform: 'darwin', openSettings }
    mockFetch({ ...health, 'GET /api/settings': { body: settings } })
    const user = userEvent.setup()
    renderWithProviders(<SettingsView />)
    await user.click(await screen.findByRole('button', { name: 'Claude API key…' }))
    expect(openSettings).toHaveBeenCalled()
  })
})
