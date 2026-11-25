import { describe, expect, it } from 'vitest'
import { answerOf, parseQuestions, cardMatches, cardMention, splitCardRefs, isPath, applyEvent, contextBar, formatTokens, emptyState, folderName, fromRecord, nextMode, replay, slashCommandsIn, slashMatches, summarizeResult, type CodeEvent } from './model.ts'

const ev = (seq: number, type: string, rest: Record<string, unknown> = {}): CodeEvent => ({ seq, type, ...rest })

describe('applyEvent', () => {
  it('joins streamed text and ignores events with a seen seq', () => {
    let s = emptyState()
    s = applyEvent(s, ev(1, 'text', { text: 'Hel' }))
    s = applyEvent(s, ev(2, 'text', { text: 'lo' }))
    s = applyEvent(s, ev(2, 'text', { text: 'lo' }))
    s = applyEvent(s, ev(1, 'text', { text: 'Hel' }))
    expect(s.items).toEqual([{ kind: 'text', key: 'e1', text: 'Hello' }])
    expect(s.lastSeq).toBe(2)
  })

  it('attaches a tool result to its call and resolves approvals', () => {
    const s = replay(
      [
        ev(1, 'tool_call', { id: 't1', name: 'Edit', input: { file_path: 'a.md' } }),
        ev(2, 'approval_request', { approvalId: 'a1', toolName: 'Edit', input: {} }),
        ev(3, 'approval_resolved', { approvalId: 'a1', allow: false }),
        ev(4, 'tool_result', { id: 't1', isError: true, summary: 'denied' }),
        ev(5, 'init', { slashCommands: ['save'] }),
        ev(6, 'status', { status: 'idle' }),
        ev(7, 'result', { isError: false, costUsd: 0.02 }),
      ],
      emptyState('running'),
    )
    expect(s.items[0]).toMatchObject({ kind: 'tool', result: { isError: true, summary: 'denied' } })
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ approval: { approvalId: 'a1', allow: false } })
    expect(s.slashCommands).toEqual(['save'])
    expect(s.status).toBe('idle')
    expect(s.lastResult?.costUsd).toBe(0.02)
  })

  it('reads stored records', () => {
    expect(fromRecord({ seq: 3, type: 'user', payload: { text: 'hi' }, createdAt: '' })).toEqual({ seq: 3, type: 'user', text: 'hi' })
  })
})

describe('one row per tool call', () => {
  const input = { command: 'ls' }
  it('merges an approval that arrives after the call', () => {
    const s = replay([ev(1, 'tool_call', { id: 't', name: 'Bash', input }), ev(2, 'approval_request', { approvalId: 'a', toolName: 'Bash', input })], emptyState())
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ id: 't', approval: { approvalId: 'a' } })
  })
  it('lets the call take over a row that only has the approval', () => {
    const s = replay(
      [ev(1, 'approval_request', { approvalId: 'a', toolName: 'Edit', input }), ev(2, 'approval_resolved', { approvalId: 'a', allow: true }), ev(3, 'tool_call', { id: 't', name: 'Edit', input }), ev(4, 'tool_result', { id: 't', isError: false, summary: 'ok' })],
      emptyState(),
    )
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ id: 't', approval: { allow: true }, result: { summary: 'ok' } })
  })
})

describe('session facts', () => {
  it('tracks model, mode, context and finished turns', () => {
    const s = replay([ev(1, 'init', { model: 'm1', slashCommands: [] }), ev(2, 'mode', { mode: 'plan' }), ev(3, 'context', { percentage: 12.4, totalTokens: 1, maxTokens: 10 }), ev(4, 'result', { isError: false })], emptyState())
    expect(s).toMatchObject({ model: 'm1', permissionMode: 'plan', context: { percentage: 12.4 }, turns: 1 })
  })
  it('cycles the modes, summarizes results and names folders', () => {
    expect(['default', 'acceptEdits', 'plan', 'auto'].map((m) => nextMode(m as never))).toEqual(['acceptEdits', 'plan', 'auto', 'default'])
    expect(summarizeResult('\n# Title\nbody\nmore')).toBe('# Title (4 lines)')
    expect(summarizeResult('')).toBe('(no output)')
    expect(folderName('/a/b/proj/')).toBe('proj')
  })
})

describe('slashMatches', () => {
  const cmds = ['save', 'plantuml', 'simplify']
  it('matches while typing a single command word', () => {
    expect(slashMatches('/s', cmds)).toEqual(['save', 'simplify'])
    expect(slashMatches('/', cmds)).toEqual(cmds)
  })
  it('stays quiet for normal text, finished commands and arguments', () => {
    expect(slashMatches('hello', cmds)).toEqual([])
    expect(slashMatches('/save', cmds)).toEqual([])
    expect(slashMatches('/save now', cmds)).toEqual([])
  })
})

describe('usage and plan usage', () => {
  it('sums usage events', () => {
    const s = replay(
      [
        ev(1, 'usage', { input: 10, output: 5, cacheRead: 100, cacheCreation: 1 }),
        ev(2, 'usage', { input: 20, output: 5, cacheRead: 0, cacheCreation: 2 }),
        ev(3, 'plan_usage', { fiveHour: { utilization: 10, resetsAt: null }, subscriptionType: 'pro' }),
        ev(4, 'plan_usage', { fiveHour: { utilization: 34, resetsAt: 'x' }, sevenDay: { utilization: 12, resetsAt: null }, subscriptionType: 'max' }),
        ev(4, 'usage', { input: 999 }),
      ],
      emptyState(),
    )
    expect(s.tokens).toEqual({ input: 30, output: 10, cacheRead: 100, cacheCreation: 3 })
  })
  it('formats tokens and picks the context bar level', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(125_400)).toBe('125k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
    expect(contextBar(0)).toEqual({ filled: 0, level: 'ok' })
    expect(contextBar(59.9).level).toBe('ok')
    expect(contextBar(60).level).toBe('warn')
    expect(contextBar(85)).toEqual({ filled: 9, level: 'high' })
    expect(contextBar(150).filled).toBe(10)
  })
})

describe('isPath', () => {
  it('detects paths and ignores other inline code', () => {
    for (const p of ['/usr/bin/env', '~/proj/a.ts', './x', 'src/app/main.ts', '../up/file']) expect(isPath(p)).toBe(true)
    for (const p of ['npm test', 'foo()', 'a/b', 'README', 'x.ts', '']) expect(isPath(p)).toBe(false)
  })
})

describe('slashCommandsIn', () => {
  it('finds slash commands but not paths', () => {
    expect(slashCommandsIn('💾 Last save: X (24.11.) – load with /fetch-save')).toEqual(['fetch-save'])
    expect(slashCommandsIn('see /Users/me/x and run /save, then /plugin:cmd.')).toEqual(['save', 'plugin:cmd'])
    expect(slashCommandsIn('no commands here')).toEqual([])
  })
})

describe('subagents', () => {
  const call = { id: 'a1', name: 'Agent', input: { description: 'Explore', subagent_type: 'Explore', prompt: 'find it' } }

  it('groups subagent events under their agent and keeps them out of the timeline', () => {
    const s = replay(
      [
        ev(1, 'tool_call', call),
        ev(2, 'text', { text: 'inner ', parentToolUseId: 'a1' }),
        ev(3, 'text', { text: 'text', parentToolUseId: 'a1' }),
        ev(4, 'tool_call', { id: 'r1', name: 'Read', input: { file_path: 'x' }, parentToolUseId: 'a1' }),
        ev(5, 'tool_result', { id: 'r1', isError: false, summary: 'body', parentToolUseId: 'a1' }),
      ],
      emptyState('running'),
    )
    expect(s.items).toHaveLength(1)
    expect(s.agents).toHaveLength(1)
    expect(s.agents[0]).toMatchObject({ id: 'a1', description: 'Explore', subagentType: 'Explore', prompt: 'find it', status: 'running' })
    expect(s.agents[0].items).toMatchObject([{ kind: 'text', text: 'inner text' }, { kind: 'tool', name: 'Read', result: { summary: 'body' } }])
  })

  it('sets the status from the main tool result; Task counts as an agent, other tools do not', () => {
    let s = replay([ev(1, 'tool_call', { ...call, name: 'Task' }), ev(2, 'tool_call', { id: 'x', name: 'Read', input: {} })], emptyState('running'))
    expect(s.agents).toHaveLength(1)
    s = applyEvent(s, ev(3, 'tool_result', { id: 'a1', isError: false, summary: 'all done' }))
    expect(s.agents[0]).toMatchObject({ status: 'done', result: 'all done' })
    s = replay([ev(1, 'tool_call', call), ev(2, 'tool_result', { id: 'a1', isError: true, summary: 'boom' })], emptyState('running'))
    expect(s.agents[0].status).toBe('error')
  })
})

describe('card references', () => {
  const c = (id: number, title: string, archivedAt: string | null = null) => ({ id, title, archivedAt })
  it('finds an @mention at the end of the draft only', () => {
    expect(cardMention('see @ret')).toEqual({ start: 4, query: 'ret' })
    expect(cardMention('@')).toEqual({ start: 0, query: '' })
    expect(cardMention('mail a@b')).toBeNull()
    expect(cardMention('@ret done')).toBeNull()
  })
  it('ranks title prefixes first and skips archived cards', () => {
    const cards = [c(1, 'Old retry', '2026-01-01'), c(2, 'Backoff and retry'), c(3, 'Retry policy'), c(4, 'Other')]
    expect(cardMatches(cards, 'retry').map((x) => x.id)).toEqual([3, 2])
    expect(cardMatches(cards, 'c4').map((x) => x.id)).toEqual([4])
  })
  it('splits [cN] references out of a message', () => {
    expect(splitCardRefs('use [c3] and [c12].')).toEqual(['use ', { cardId: 3 }, ' and ', { cardId: 12 }, '.'])
  })
})

describe('questions and queue', () => {
  it('builds answers from picked options and free text', () => {
    expect(answerOf({ picked: ['A'], other: '', otherOn: false }, false)).toBe('A')
    expect(answerOf({ picked: [], other: ' mine ', otherOn: true }, false)).toBe('mine')
    expect(answerOf({ picked: ['A', 'B'], other: 'C', otherOn: true }, true)).toBe('A, B, C')
    expect(answerOf({ picked: [], other: '', otherOn: true }, true)).toBe('')
  })

  it('parses questions and drops malformed ones', () => {
    expect(parseQuestions({ questions: [{ question: 'Q?', header: 'H', options: [{ label: 'x' }, { nope: 1 }] }, { header: 'no question' }] })).toEqual([
      { question: 'Q?', header: 'H', multiSelect: false, options: [{ label: 'x', description: '' }] },
    ])
    expect(parseQuestions(null)).toEqual([])
  })

  it('keeps the latest queue and the answers of a resolved approval', () => {
    let s = applyEvent(emptyState(), { seq: 1, type: 'queue', items: [{ id: 'a', text: 'one' }, { bad: true }] })
    expect(s.queue).toEqual([{ id: 'a', text: 'one' }])
    s = applyEvent(s, { seq: 2, type: 'queue', items: [] })
    expect(s.queue).toEqual([])
    s = applyEvent(s, { seq: 3, type: 'approval_request', approvalId: 'x', toolName: 'AskUserQuestion', input: {} })
    s = applyEvent(s, { seq: 4, type: 'approval_resolved', approvalId: 'x', allow: true, answers: { 'Q?': 'A' } })
    expect(s.items[0]).toMatchObject({ approval: { approvalId: 'x', allow: true, answers: { 'Q?': 'A' } } })
  })
})
