import { ThemeProvider } from '@primer/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { selectActiveTab, useWorkspace, pathToTab } from '../../state/workspace.ts'
import { mockFetch, renderWithProviders, sseEvent } from '../../test/utils.tsx'
import { CardNode } from '../graph/CardNode.tsx'
import { CitationChip } from '../chat/CitationChip.tsx'
import { ModeSwitch } from './ModeSwitch.tsx'
import { SessionList } from './SessionList.tsx'
import { CodeSessionView } from './SessionView.tsx'

const initial = useWorkspace.getState()
const baseSettings = { defaultModel: null, ablationRuns: 3, baselineRuns: 3, ablationTemperature: 0.2, accentColor: null, codeAuth: 'local_login' }
const session = (id: number, title: string, status = 'idle', permissionMode = 'default') => ({ id, title, projectPath: '/work/p', status, permissionMode, createdAt: '', updatedAt: '' })
const status = { 'GET /api/code/status': { body: { available: true, mode: 'claude_code', codeAuth: 'local_login' } } }
const rec = (seq: number, type: string, payload: object) => ({ seq, type, payload, createdAt: '' })

beforeEach(() => useWorkspace.setState({ ...initial, panes: [{ tabs: [], activeTabId: null }], activePane: 0 }))
afterEach(() => vi.unstubAllGlobals())

describe('mode switch', () => {
  it('sends PUT /settings with the chosen mode', async () => {
    const { calls } = mockFetch({
      'GET /api/settings': { body: { ...baseSettings, mode: 'api' } },
      'PUT /api/settings': ({ body }) => ({ body: { ...baseSettings, ...(body as object) } }),
    })
    const user = userEvent.setup()
    renderWithProviders(<ModeSwitch />)
    const code = await screen.findByRole('radio', { name: 'Agent' })
    expect(screen.getByRole('radio', { name: 'API' })).toHaveAttribute('aria-checked', 'true')
    await user.click(code)
    await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/settings')?.body).toEqual({ mode: 'claude_code' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Agent' })).toHaveAttribute('aria-checked', 'true'))
  })
})

describe('session list', () => {
  it('lists sessions with status and opens a tab', async () => {
    mockFetch({ ...status, 'GET /api/code/sessions': { body: [session(1, 'Alpha', 'running'), session(2, 'Beta')] } })
    const user = userEvent.setup()
    renderWithProviders(<SessionList />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument()
    await user.click(screen.getByText('Beta'))
    expect(selectActiveTab(useWorkspace.getState())?.id).toBe('code:2')
  })

  it('shows the account-wide plan limits once, below the sessions', async () => {
    mockFetch({
      ...status,
      'GET /api/code/sessions': { body: [session(1, 'Alpha'), session(2, 'Beta')] },
      'GET /api/code/plan-usage': { body: { fiveHour: { utilization: 34, resetsAt: null }, sevenDay: { utilization: 12, resetsAt: null }, subscriptionType: 'max', observedAt: '2026-11-24T20:00:00.000Z' } },
    })
    renderWithProviders(<SessionList />)
    expect(await screen.findByTestId('plan-usage')).toHaveTextContent('Plan limits · 5h 34% · 7d 12%')
  })

  it('creates a session from the dialog and opens it', async () => {
    const { calls } = mockFetch({
      ...status,
      'GET /api/code/sessions': { body: [] },
      'POST /api/code/sessions': { status: 201, body: session(7, 'p') },
    })
    const user = userEvent.setup()
    renderWithProviders(<SessionList />)
    await user.click(await screen.findByRole('button', { name: 'New session' }))
    expect(await screen.findByText(/PromptSys never sees your login/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Project folder/), '/work/p')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(selectActiveTab(useWorkspace.getState())?.id).toBe('code:7'))
    expect(calls.find((c) => c.key === 'POST /api/code/sessions')?.body).toEqual({ projectPath: '/work/p' })
  })

  it('fills the project folder from the desktop folder picker', async () => {
    window.promptsys = { isDesktop: true, chooseFolder: () => Promise.resolve('/Users/me/picked') }
    try {
      const { calls } = mockFetch({
        ...status,
        'GET /api/code/sessions': { body: [] },
        'POST /api/code/sessions': { status: 201, body: session(8, 'picked') },
      })
      const user = userEvent.setup()
      renderWithProviders(<SessionList />)
      await user.click(await screen.findByRole('button', { name: 'New session' }))
      await user.click(screen.getByRole('button', { name: /Choose/ }))
      await waitFor(() => expect(screen.getByLabelText(/Project folder/)).toHaveValue('/Users/me/picked'))
      await user.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions')?.body).toEqual({ projectPath: '/Users/me/picked' }))
    } finally {
      delete window.promptsys
    }
  })

  it('offers no folder picker in the browser', async () => {
    mockFetch({ ...status, 'GET /api/code/sessions': { body: [] } })
    const user = userEvent.setup()
    renderWithProviders(<SessionList />)
    await user.click(await screen.findByRole('button', { name: 'New session' }))
    expect(screen.queryByRole('button', { name: /Choose/ })).not.toBeInTheDocument()
  })

  it('shows why Claude Code is unavailable', async () => {
    mockFetch({ 'GET /api/code/status': { body: { available: false, reason: 'SDK missing', mode: 'claude_code', codeAuth: 'local_login' } }, 'GET /api/code/sessions': { body: [] } })
    renderWithProviders(<SessionList />)
    expect(await screen.findByText(/SDK missing/)).toBeInTheDocument()
  })
})

function sessionRoutes(events: ReturnType<typeof rec>[], live: string[] = [], extra: Record<string, never | object> = {}) {
  return {
    ...status,
    'GET /api/code/sessions/1': { body: { session: session(1, 'Alpha'), slashCommands: ['save', 'plantuml'], events } },
    'GET /api/code/sessions/1/stream': { sse: live },
    'GET /api/code/sessions/1/cards': { body: [] },
    'GET /api/code/sessions/1/git': { body: { isGitRepo: true, branch: 'main', dirty: true } },
    ...extra,
  }
}

describe('session view', () => {
  it('queues a message while the agent works, lists it and removes it', async () => {
    const { calls } = mockFetch(
      sessionRoutes(
        [rec(1, 'user', { text: 'work' }), rec(2, 'status', { status: 'running' }), rec(3, 'queue', { items: [{ id: 'q1', text: 'next task' }] })],
        [],
        {
          'POST /api/code/sessions/1/messages': { status: 202, body: { accepted: true, queued: true } },
          'DELETE /api/code/sessions/1/queue/q1': { status: 204 },
        },
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const queue = await screen.findByRole('list', { name: 'Queued messages' })
    expect(queue).toHaveTextContent('next task')
    expect(screen.getByText('Esc to interrupt')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'one more')
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/messages')?.body).toEqual({ text: 'one more' }))
    await user.click(within(queue).getByRole('button', { name: 'Remove queued message' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /api/code/sessions/1/queue/q1')).toBe(true))
  })

  it('Esc interrupts a running turn and puts queued messages back into the input field', async () => {
    const { calls } = mockFetch(
      sessionRoutes([rec(1, 'user', { text: 'work' }), rec(2, 'status', { status: 'running' }), rec(3, 'queue', { items: [{ id: 'q1', text: 'next task' }] })], [], {
        'POST /api/code/sessions/1/stop': { status: 204 },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    await screen.findByRole('list', { name: 'Queued messages' })
    await user.click(screen.getByRole('textbox', { name: 'Message' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/code/sessions/1/stop')).toBe(true))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('next task'))
  })

  it('shows an AskUserQuestion as a form and sends the answers', async () => {
    const input = {
      questions: [
        { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'SQLite', description: 'One file' }, { label: 'Postgres', description: 'A server' }] },
        { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Docs', description: '' }, { label: 'Tests', description: '' }] },
      ],
    }
    const { calls } = mockFetch(
      sessionRoutes([rec(1, 'tool_call', { id: 't1', name: 'AskUserQuestion', input }), rec(2, 'approval_request', { approvalId: 'a1', toolName: 'AskUserQuestion', input }), rec(3, 'status', { status: 'waiting_approval' })], [], {
        'POST /api/code/sessions/1/approvals/a1': { status: 204 },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const form = await screen.findByRole('form', { name: 'Questions from the agent' })
    const submit = within(form).getByRole('button', { name: 'Submit answers' })
    expect(submit).toBeDisabled()
    await user.click(within(form).getByRole('radio', { name: /Postgres/ }))
    await user.click(within(form).getByRole('checkbox', { name: /Docs/ }))
    await user.click(within(form).getAllByRole('checkbox', { name: 'Other' })[0])
    await user.type(within(form).getByRole('textbox', { name: 'Your answer to: Which extras?' }), 'CI')
    await user.click(submit)
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/approvals/a1')?.body).toEqual({ allow: true, answers: { 'Which database?': 'Postgres', 'Which extras?': 'Docs, CI' } }),
    )
  })

  it('shows a plan and approves it with a permission mode, or sends it back with a note', async () => {
    const input = { plan: '## Steps\n1. Add the table' }
    const { calls } = mockFetch(
      sessionRoutes([rec(1, 'tool_call', { id: 't1', name: 'ExitPlanMode', input }), rec(2, 'approval_request', { approvalId: 'a1', toolName: 'ExitPlanMode', input })], [], {
        'POST /api/code/sessions/1/approvals/a1': { status: 204 },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const group = await screen.findByRole('group', { name: 'Plan approval' })
    expect(within(group).getByRole('heading', { name: 'Steps' })).toBeInTheDocument()
    await user.type(within(group).getByRole('textbox', { name: 'Note for the agent' }), 'add docs')
    await user.click(within(group).getByRole('button', { name: 'Keep planning' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/approvals/a1')?.body).toEqual({ allow: false, message: 'add docs' }))
    await user.click(within(group).getByRole('button', { name: 'Yes, accept edits' }))
    await waitFor(() => expect(calls.filter((c) => c.key === 'POST /api/code/sessions/1/approvals/a1').at(-1)?.body).toEqual({ allow: true, mode: 'acceptEdits' }))
  })

  it('does not carry a running state over when the view switches to another session', async () => {
    const { calls } = mockFetch({
      ...status,
      'GET /api/code/sessions/1': { body: { session: session(1, 'Busy', 'running'), slashCommands: [], events: [rec(1, 'user', { text: 'work' }), rec(2, 'status', { status: 'running' })] } },
      'GET /api/code/sessions/1/stream': { sse: [sseEvent('text', { seq: 3, text: 'still working' })] },
      'GET /api/code/sessions/1/cards': { body: [] },
      'GET /api/code/sessions/2': { body: { session: session(2, 'Free'), slashCommands: [], events: [] } },
      'GET /api/code/sessions/2/stream': { sse: [] },
      'GET /api/code/sessions/2/cards': { body: [] },
      'POST /api/code/sessions/2/messages': { status: 202, body: { accepted: true } },
    })
    const user = userEvent.setup()
    const view = renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByText('still working')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/The agent is working…/)).toBeInTheDocument()
    view.rerender(
      <ThemeProvider colorMode="night">
        <QueryClientProvider client={view.client}>
          <CodeSessionView sessionId={2} />
        </QueryClientProvider>
      </ThemeProvider>,
    )
    const input = await screen.findByPlaceholderText(/Message the agent/)
    await user.type(input, 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/2/messages')?.body).toEqual({ text: 'hello' }))
  })

  it('shows a SessionStart notice and runs the offered slash command', async () => {
    const { calls } = mockFetch(
      sessionRoutes([rec(1, 'notice', { text: 'Last save: X – load with /save', source: 'SessionStart' })], [], {
        'POST /api/code/sessions/1/messages': { status: 202, body: { accepted: true } },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByText('Last save: X – load with /save')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run /save' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/messages')?.body).toEqual({ text: '/save' }))
  })

  it('shows the cost of the last turn only when an API key is used', async () => {
    mockFetch(
      sessionRoutes([rec(1, 'result', { isError: false, costUsd: 0.0123 })], [], {
        'GET /api/code/status': { body: { available: true, mode: 'claude_code', codeAuth: 'api_key' } },
      }),
    )
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByText('$0.0123')).toBeInTheDocument()
  })

  it('renders history and live events, joins streamed text and dedupes by seq', async () => {
    mockFetch(
      sessionRoutes(
        [rec(1, 'user', { text: 'Fix it' }), rec(2, 'tool_call', { id: 't', name: 'Read', input: { file_path: 'a.ts' } }), rec(3, 'text', { text: 'Look' })],
        [
          sseEvent('text', { seq: 3, text: 'Look' }), // already in history
          sseEvent('text', { seq: 4, text: 'ing now' }),
          sseEvent('tool_result', { seq: 5, id: 't', isError: false, summary: 'file body' }),
          sseEvent('card', { seq: 6, cardId: 12, action: 'created' }),
          sseEvent('status', { seq: 7, status: 'running' }),
          sseEvent('result', { seq: 8, isError: false, costUsd: 0.0123 }),
        ],
      ),
    )
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByText('Fix it')).toBeInTheDocument()
    expect(await screen.findByText('Looking now')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show details' }))
    expect(document.querySelector('pre[data-result]')?.textContent).toBe('file body')
    expect(screen.getByRole('button', { name: 'Card c12 created' })).toBeInTheDocument()
    // Local login: the SDK's API-price estimate is not a charge and is not shown.
    expect(screen.queryByText('$0.0123')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Running')
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument()
  })

  it('posts the decision when Allow or Deny is clicked', async () => {
    const { calls } = mockFetch(
      sessionRoutes([rec(1, 'approval_request', { approvalId: 'ap1', toolName: 'Edit', input: { file_path: 'README.md' } })], [], {
        'POST /api/code/sessions/1/approvals/ap1': { status: 204 },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    await user.click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/approvals/ap1')?.body).toEqual({ allow: false }))
  })

  it('shows one row per tool call with the approval inside, and a collapsed result', async () => {
    const long = '# Heading\n'.repeat(40)
    const { calls } = mockFetch(
      sessionRoutes(
        [
          rec(1, 'tool_call', { id: 't1', name: 'Bash', input: { command: 'npm test' } }),
          rec(2, 'approval_request', { approvalId: 'ap1', toolName: 'Bash', input: { command: 'npm test' } }),
          rec(3, 'tool_call', { id: 't2', name: 'Read', input: { file_path: 'README.md' } }),
          rec(4, 'tool_result', { id: 't2', isError: false, summary: long }),
        ],
        [],
        { 'POST /api/code/sessions/1/approvals/ap1': { status: 204 } },
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const bash = await screen.findByRole('group', { name: 'Tool Bash' })
    expect(screen.getAllByText('npm test')).toHaveLength(1)
    await user.click(within(bash).getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/approvals/ap1')?.body).toEqual({ allow: true }))
    const read = screen.getByRole('group', { name: 'Tool Read' })
    // collapsed: one summary line, the long text is not in the page
    expect(within(read).getByText('# Heading (40 lines)')).toBeInTheDocument()
    expect(read.querySelector('pre')).toBeNull()
    await user.click(within(read).getByRole('button', { name: 'Show details' }))
    expect(read.querySelector('pre[data-result]')?.textContent).toBe(long)
    await user.click(within(read).getByRole('button', { name: 'Hide details' }))
    expect(read.querySelector('pre')).toBeNull()
  })

  it('shows Allowed or Denied inside the row once decided', async () => {
    mockFetch(
      sessionRoutes([
        rec(1, 'approval_request', { approvalId: 'a', toolName: 'Edit', input: { file_path: 'a' } }),
        rec(2, 'approval_resolved', { approvalId: 'a', allow: true }),
        rec(3, 'tool_call', { id: 't', name: 'Edit', input: { file_path: 'a' } }),
      ]),
    )
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const row = await screen.findByRole('group', { name: 'Tool Edit' })
    expect(row).toHaveTextContent('Allowed')
    expect(within(row).queryByRole('button', { name: 'Allow' })).toBeNull()
    expect(screen.getAllByRole('group', { name: /Tool/ })).toHaveLength(1)
  })

  it('switches the permission mode by select and with Shift+Tab, and highlights non-Ask modes', async () => {
    const { calls } = mockFetch(sessionRoutes([], [], { 'PATCH /api/code/sessions/1': ({ body }: { body?: unknown }) => ({ body: { ...session(1, 'Alpha'), ...(body as object) } }) }))
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const select = await screen.findByRole('combobox', { name: 'Permission mode' })
    expect(select).toHaveValue('default')
    expect(select.closest('label')).not.toHaveAttribute('data-active')
    await user.selectOptions(select, 'plan')
    await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/code/sessions/1').map((c) => c.body)).toEqual([{ permissionMode: 'plan' }]))
    expect(select).toHaveValue('plan')
    expect(select.closest('label')).toHaveAttribute('data-active')
    await user.click(screen.getByLabelText('Message'))
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(select).toHaveValue('auto'))
    await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/code/sessions/1').pop()?.body).toEqual({ permissionMode: 'auto' }))
  })

  it('shows the status line: model, folder, branch with dirty flag, context and mode', async () => {
    mockFetch(sessionRoutes([rec(1, 'init', { model: 'claude-x', slashCommands: [] }), rec(2, 'context', { percentage: 41.6, totalTokens: 83200, maxTokens: 200000 }), rec(3, 'mode', { mode: 'acceptEdits' })]))
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const line = await screen.findByRole('group', { name: 'Session status' })
    await waitFor(() => expect(line).toHaveTextContent('main*'))
    expect(line).toHaveTextContent('claude-x')
    expect(line).toHaveTextContent('p')
    expect(line).toHaveTextContent('Context')
    expect(line).toHaveTextContent('42%')
    expect(within(line).getByTestId('context-bar')).toHaveAttribute('data-level', 'ok')
    expect(within(line).getByRole('combobox', { name: 'Permission mode' })).toHaveValue('acceptEdits')
  })

  it('shows tokens (plan limits are not per session), and a placeholder for context before any turn', async () => {
    mockFetch(sessionRoutes([rec(1, 'usage', { input: 100_000, output: 5_000, cacheRead: 20_000, cacheCreation: 400 }), rec(2, 'plan_usage', { fiveHour: { utilization: 34, resetsAt: null }, sevenDay: { utilization: 12, resetsAt: null }, subscriptionType: 'max' })]))
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const line = await screen.findByRole('group', { name: 'Session status' })
    await waitFor(() => expect(line).toHaveTextContent('Tokens 125k'))
    expect(line).not.toHaveTextContent('5h')
    expect(line).toHaveTextContent('Context –')
  })

  it('hides tokens and plan usage when there is no data', async () => {
    mockFetch(sessionRoutes([]))
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const line = await screen.findByRole('group', { name: 'Session status' })
    expect(line).not.toHaveTextContent('Tokens')
    expect(line).not.toHaveTextContent('5h')
  })

  it('omits the branch outside a git repo', async () => {
    mockFetch(sessionRoutes([], [], { 'GET /api/code/sessions/1/git': { body: { isGitRepo: false } } }))
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const line = await screen.findByRole('group', { name: 'Session status' })
    expect(line).not.toHaveTextContent('main')
  })

  it('shows subagents in the Agents tab, switches tabs, expands and opens from the Show button', async () => {
    const events = [
      rec(1, 'tool_call', { id: 'a1', name: 'Agent', input: { description: 'Explore repo', subagent_type: 'Explore', prompt: 'find stuff' } }),
      rec(2, 'text', { text: 'sub says hi', parentToolUseId: 'a1' }),
      rec(3, 'tool_call', { id: 'r1', name: 'Read', input: { file_path: 'a.ts' }, parentToolUseId: 'a1' }),
      rec(4, 'tool_result', { id: 'r1', isError: false, summary: 'ok', parentToolUseId: 'a1' }),
      rec(5, 'tool_call', { id: 'b1', name: 'Agent', input: { description: 'Second', subagent_type: 'x', prompt: 'p' } }),
      rec(6, 'tool_result', { id: 'a1', isError: false, summary: 'final answer' }),
    ]
    mockFetch(sessionRoutes(events))
    localStorage.removeItem('promptsys.code.sidetab.1')
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const timeline = await screen.findByRole('list', { name: 'Timeline' })
    expect(within(timeline).queryByText('sub says hi')).toBeNull()
    expect(within(timeline).getAllByRole('group', { name: 'Tool Agent' })).toHaveLength(2)
    await screen.findByRole('complementary', { name: 'Cards from this session' })
    expect(within(screen.getByRole('tab', { name: /Agents/ })).getByLabelText('1 running')).toBeInTheDocument()
    await user.click(within(timeline).getAllByRole('button', { name: 'Show' })[0])
    const panel = await screen.findByRole('complementary', { name: 'Agents' })
    expect(screen.getByRole('tab', { name: /Agents/ })).toHaveAttribute('aria-selected', 'true')
    expect(localStorage.getItem('promptsys.code.sidetab.1')).toBe('agents')
    expect(within(panel).getByText('sub says hi')).toBeInTheDocument()
    expect(within(panel).getByText('final answer')).toBeInTheDocument()
    expect(within(panel).queryByText('find stuff')).toBeNull()
    await user.click(within(panel).getByRole('button', { name: /Second/ }))
    expect(within(panel).queryByText('sub says hi')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Cards' }))
    expect(await screen.findByRole('complementary', { name: 'Cards from this session' })).toBeInTheDocument()
    expect(localStorage.getItem('promptsys.code.sidetab.1')).toBe('cards')
    localStorage.removeItem('promptsys.code.sidetab.1')
  })

  it('toggles the Changes panel, remembers it, lists files and shows a colored diff', async () => {
    const files = [
      { path: 'src/a.ts', status: 'modified', added: 2, removed: 1, truncated: false, diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n' },
      { path: 'b.txt', status: 'untracked', added: 1, removed: 0, truncated: false, diff: '+x' },
    ]
    const { calls } = mockFetch(sessionRoutes([], [], { 'GET /api/code/sessions/1/changes': { body: { isGitRepo: true, files } } }))
    localStorage.removeItem('promptsys.code.changes.1')
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    await user.click(await screen.findByRole('button', { name: 'Show changes' }))
    const panel = await screen.findByRole('complementary', { name: 'Changes' })
    expect(await within(panel).findByText(/2 files changed/)).toHaveTextContent('+3')
    expect(panel).toHaveTextContent('−1')
    expect(localStorage.getItem('promptsys.code.changes.1')).toBe('1')
    await user.click(within(panel).getByRole('button', { name: /src\/a\.ts/ }))
    expect(within(panel).getByText('+new')).toHaveAttribute('data-kind', 'add')
    expect(within(panel).getByText('-old')).toHaveAttribute('data-kind', 'del')
    const before = calls.filter((c) => c.key === 'GET /api/code/sessions/1/changes').length
    await user.click(within(panel).getByRole('button', { name: 'Refresh changes' }))
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /api/code/sessions/1/changes').length).toBeGreaterThan(before))
    await user.click(screen.getByRole('button', { name: 'Hide changes' }))
    expect(screen.queryByRole('complementary', { name: 'Changes' })).toBeNull()
    expect(localStorage.getItem('promptsys.code.changes.1')).toBe('0')
    localStorage.removeItem('promptsys.code.changes.1')
  })

  it('says so when the project is not a git repository', async () => {
    mockFetch(sessionRoutes([], [], { 'GET /api/code/sessions/1/changes': { body: { isGitRepo: false, files: [] } } }))
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    await user.click(await screen.findByRole('button', { name: 'Show changes' }))
    expect(await screen.findByText(/not a git repository/)).toBeInTheDocument()
    localStorage.removeItem('promptsys.code.changes.1')
  })

  it('renders agent Markdown tables and [cN] references as card chips', async () => {
    mockFetch(sessionRoutes([rec(1, 'text', { text: 'See [c15].\n\n| Card | Content |\n|---|---|\n| c18 | Identity |' })]))
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Content' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Identity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /c15/ })).toBeInTheDocument()
  })

  it('suggests slash commands and sends the message', async () => {
    const { calls } = mockFetch(sessionRoutes([], [], { 'POST /api/code/sessions/1/messages': { status: 202, body: { accepted: true } } }))
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    const box = await screen.findByLabelText('Message')
    await user.type(box, '/pl')
    const option = await screen.findByRole('option', { name: '/plantuml' })
    expect(screen.queryByRole('option', { name: '/save' })).not.toBeInTheDocument()
    await user.click(option)
    expect(box).toHaveValue('/plantuml ')
    await user.type(box, 'docs')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/messages')?.body).toEqual({ text: '/plantuml docs' }))
  })

  it('references a card with @ and shows it as a chip in the sent message', async () => {
    const card = (id: number, title: string) => ({ id, title, excerpt: '', kind: 'note', folderPath: 'p/backend', defaultIncluded: false, version: 1, mergedInto: null, archivedAt: null, createdAt: '', updatedAt: '' })
    const { calls } = mockFetch(
      sessionRoutes([rec(1, 'user', { text: 'see [c7] please' })], [], {
        'GET /api/cards': { body: [card(7, 'Retry policy'), card(8, 'Agent runner')] },
        'POST /api/code/sessions/1/messages': { status: 202, body: { accepted: true } },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByRole('button', { name: /c7/ })).toBeInTheDocument()
    const box = await screen.findByLabelText('Message')
    await user.type(box, 'apply @ret')
    const option = await screen.findByRole('option', { name: /c7 Retry policy/ })
    expect(screen.queryByRole('option', { name: /Agent runner/ })).not.toBeInTheDocument()
    await user.click(option)
    expect(box).toHaveValue('apply [c7] ')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /api/code/sessions/1/messages')?.body).toEqual({ text: 'apply [c7]' }))
  })

  it('confirms, corrects and rejects cards of the session', async () => {
    const cards = [
      { id: 5, title: 'Understanding A', body: 'body a', reviewStatus: 'proposed', version: 1 },
      { id: 6, title: 'Rule B', body: 'body b', reviewStatus: 'proposed', version: 1 },
    ]
    const { calls } = mockFetch(
      sessionRoutes([], [], {
        'GET /api/code/sessions/1/cards': { body: cards },
        'PATCH /api/code/cards/5': { body: {} },
        'PATCH /api/code/cards/6': { body: {} },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<CodeSessionView sessionId={1} />)
    await screen.findByText('Understanding A')
    const [confirmBtn] = screen.getAllByRole('button', { name: 'Confirm' })
    await user.click(confirmBtn)
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/code/cards/5')?.body).toEqual({ reviewStatus: 'confirmed' }))
    await user.click(screen.getAllByRole('button', { name: 'Reject' })[1])
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/code/cards/6')?.body).toEqual({ reviewStatus: 'rejected' }))
    await user.click(screen.getAllByRole('button', { name: 'Correct' })[0])
    const title = screen.getByLabelText('Card title')
    await user.clear(title)
    await user.type(title, 'Better title')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(calls.filter((c) => c.key === 'PATCH /api/code/cards/5').pop()?.body).toEqual({ title: 'Better title', body: 'body a' }))
  })

  it('shows the reason when Claude Code is unavailable', async () => {
    mockFetch({
      'GET /api/code/status': { body: { available: false, reason: 'Claude Code is not installed', mode: 'claude_code', codeAuth: 'local_login' } },
      'GET /api/code/sessions/1': { body: { session: session(1, 'Alpha'), slashCommands: [], events: [] } },
      'GET /api/code/sessions/1/stream': { sse: [] },
    })
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByText('Claude Code is not installed')).toBeInTheDocument()
  })

  it('explains that the mode is off when the backend answers 409', async () => {
    mockFetch({
      'GET /api/code/status': { body: { available: true, mode: 'api', codeAuth: 'local_login' } },
      'GET /api/settings': { body: { ...baseSettings, mode: 'api' } },
      'GET /api/code/sessions/1': { status: 409, body: { error: { code: 'feature_requires_claude_code_mode', message: 'x' } } },
    })
    renderWithProviders(<CodeSessionView sessionId={1} />)
    expect(await screen.findByText('Agent mode is off')).toBeInTheDocument()
  })
})

describe('API-only controls', () => {
  const chip = <CitationChip marker="[c1]" cardId={1} onWhy={() => undefined} />
  it('disables Why? in Agent mode with a tooltip', async () => {
    mockFetch({ 'GET /api/settings': { body: { ...baseSettings, mode: 'claude_code' } }, 'GET /api/cards/1': { status: 404, body: { error: { code: 'not_found', message: 'x' } } } })
    renderWithProviders(chip)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Why [c1]?' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Why [c1]?' })).toHaveAttribute('title', 'Only available in API mode')
  })
  it('keeps Why? enabled in API mode', async () => {
    mockFetch({ 'GET /api/settings': { body: { ...baseSettings, mode: 'api' } }, 'GET /api/cards/1': { status: 404, body: { error: { code: 'not_found', message: 'x' } } } })
    renderWithProviders(chip)
    await screen.findByRole('button', { name: 'Why [c1]?' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Why [c1]?' })).toBeEnabled())
  })
})

describe('misc', () => {
  it('maps /code/:id to a tab', () => {
    expect(pathToTab('/code/4')).toEqual({ id: 'code:4', type: 'code', refId: 4 })
  })
  it('marks agent cards in the graph', async () => {
    const { container } = renderWithProviders(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 300 }}>
          <ReactFlow
            nodeTypes={{ card: CardNode }}
            nodes={[{ id: '1', type: 'card', position: { x: 0, y: 0 }, data: { cardId: 1, title: 'A', kind: 'note', degree: 0, inContext: false, dimmed: false, origin: 'agent', reviewStatus: 'confirmed' } }]}
            edges={[]}
          />
        </div>
      </ReactFlowProvider>,
    )
    await waitFor(() => expect(container.querySelector('[aria-label="Agent card, confirmed"]')).not.toBeNull())
  })
})
