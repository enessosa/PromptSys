import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextFromResult, findClaudeExecutable, hookSystemMessage, isInsideProject, mapSdkMessage, planUsageFromResponse, preToolUseDecision, sdkPermissionMode, usageFromResult } from './sdk.ts'

// Hand-written message shapes (only the fields the mapping reads).
const msg = (m: unknown) => m as SDKMessage

describe('mapSdkMessage', () => {
  it('maps system/init to init with the slash commands', () => {
    const events = mapSdkMessage(msg({ type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-x', slash_commands: ['save', 'plantuml'] }))
    expect(events).toEqual([{ type: 'init', sdkSessionId: 's-1', model: 'claude-x', slashCommands: ['save', 'plantuml'] }])
  })

  it('maps assistant text and tool_use blocks, skips empty text and thinking', () => {
    const events = mapSdkMessage(
      msg({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'Let me look.' },
            { type: 'text', text: '  ' },
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a' } },
          ],
        },
      }),
    )
    expect(events).toEqual([
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_call', id: 'tu_1', name: 'Read', input: { file_path: '/a' } },
    ])
  })

  it('maps user tool_result blocks (string and block content) and truncates long results', () => {
    const events = mapSdkMessage(
      msg({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'x'.repeat(5000) },
            { type: 'tool_result', tool_use_id: 'tu_2', is_error: true, content: [{ type: 'text', text: 'boom' }, { type: 'image' }] },
          ],
        },
      }),
    )
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'tool_result', id: 'tu_1', isError: false })
    expect((events[0] as { summary: string }).summary.length).toBeLessThanOrEqual(2001)
    expect(events[1]).toEqual({ type: 'tool_result', id: 'tu_2', isError: true, summary: 'boom\n[image]' })
  })

  it('ignores plain user text and sub-agent messages', () => {
    expect(mapSdkMessage(msg({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: 'hi' } }))).toEqual([])
    expect(mapSdkMessage(msg({ type: 'assistant', parent_tool_use_id: 'tu_9', message: { content: [{ type: 'text', text: 'inner' }] } }))).toEqual([{ type: 'text', text: 'inner', parentToolUseId: 'tu_9' }])
  })

  it('tags subagent tool calls and results with the parent tool id', () => {
    const call = mapSdkMessage(msg({ type: 'assistant', parent_tool_use_id: 'tu_9', message: { content: [{ type: 'tool_use', id: 'tu_10', name: 'Read', input: { file_path: '/a' } }] } }))
    expect(call).toEqual([{ type: 'tool_call', id: 'tu_10', name: 'Read', input: { file_path: '/a' }, parentToolUseId: 'tu_9' }])
    const result = mapSdkMessage(msg({ type: 'user', parent_tool_use_id: 'tu_9', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_10', content: 'ok' }] } }))
    expect(result).toEqual([{ type: 'tool_result', id: 'tu_10', isError: false, summary: 'ok', parentToolUseId: 'tu_9' }])
  })

  it('maps result with cost and duration, also for errors', () => {
    expect(mapSdkMessage(msg({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, duration_ms: 4200 }))).toEqual([
      { type: 'result', isError: false, costUsd: 0.0123, durationMs: 4200 },
    ])
    expect(mapSdkMessage(msg({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.5, duration_ms: 10 }))).toEqual([
      { type: 'result', isError: true, costUsd: 0.5, durationMs: 10 },
    ])
  })

  it('drops everything else', () => {
    expect(mapSdkMessage(msg({ type: 'system', subtype: 'status' }))).toEqual([])
    expect(mapSdkMessage(msg({ type: 'stream_event' }))).toEqual([])
  })
})

describe('preToolUseDecision', () => {
  it('lets read-only tools and the own card tools through', () => {
    for (const name of ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'mcp__promptsys__record_card', 'mcp__promptsys__link_cards']) {
      expect(preToolUseDecision(name)).toBe('allow')
    }
  })

  it('asks for everything that can change something or reach out', () => {
    for (const name of ['Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'mcp__other__thing']) {
      expect(preToolUseDecision(name)).toBe('ask')
    }
  })

  it('asks for read-only tools that point outside the project folder (NFR-12)', () => {
    const base = mkdtempSync(join(tmpdir(), 'promptsys-gate-'))
    const project = join(base, 'project')
    mkdirSync(join(project, 'src'), { recursive: true })
    symlinkSync(base, join(project, 'escape'))
    expect(preToolUseDecision('Read', { file_path: join(project, 'src', 'a.ts') }, project)).toBe('allow')
    expect(preToolUseDecision('Grep', { pattern: 'x', path: 'src' }, project)).toBe('allow')
    expect(preToolUseDecision('Glob', { pattern: '**/*.ts' }, project)).toBe('allow')
    expect(preToolUseDecision('Read', { file_path: '/etc/hosts' }, project)).toBe('ask')
    expect(preToolUseDecision('Read', { file_path: '../secret.txt' }, project)).toBe('ask')
    expect(preToolUseDecision('Grep', { pattern: 'x', path: join(project, 'escape') }, project)).toBe('ask')
    expect(isInsideProject(project, project)).toBe(true)
  })
})

describe('preToolUseDecision per permission mode', () => {
  const project = mkdtempSync(join(tmpdir(), 'promptsys-gate-'))
  const inside = { file_path: join(project, 'a.ts') }
  const outside = { file_path: '/etc/hosts' }

  it('Ask: only read-only tools and own card tools run on their own', () => {
    expect(preToolUseDecision('Edit', inside, project, 'default')).toBe('ask')
    expect(preToolUseDecision('Bash', { command: 'ls' }, project, 'default')).toBe('ask')
    expect(preToolUseDecision('Read', inside, project, 'default')).toBe('allow')
    expect(preToolUseDecision('mcp__promptsys__record_card', {}, project, 'default')).toBe('allow')
  })

  it('Accept edits: edit tools inside the project run, outside or without a path and Bash still ask', () => {
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) {
      expect(preToolUseDecision(tool, inside, project, 'acceptEdits')).toBe('allow')
      expect(preToolUseDecision(tool, outside, project, 'acceptEdits')).toBe('ask')
      expect(preToolUseDecision(tool, {}, project, 'acceptEdits')).toBe('ask')
    }
    expect(preToolUseDecision('NotebookEdit', { notebook_path: join(project, 'n.ipynb') }, project, 'acceptEdits')).toBe('allow')
    expect(preToolUseDecision('Edit', { file_path: join(project, '..', 'x') }, project, 'acceptEdits')).toBe('ask')
    expect(preToolUseDecision('Bash', { command: 'rm -rf x' }, project, 'acceptEdits')).toBe('ask')
    expect(preToolUseDecision('Read', outside, project, 'acceptEdits')).toBe('ask')
  })

  it('Plan: read-only tools run, everything else asks', () => {
    expect(preToolUseDecision('Read', inside, project, 'plan')).toBe('allow')
    expect(preToolUseDecision('Edit', inside, project, 'plan')).toBe('ask')
  })

  it('Auto: the hook gives no decision except for safe reads and own tools; the SDK decides the rest', () => {
    expect(preToolUseDecision('Bash', { command: 'ls' }, project, 'auto')).toBe('none')
    expect(preToolUseDecision('Edit', inside, project, 'auto')).toBe('none')
    expect(preToolUseDecision('Read', inside, project, 'auto')).toBe('allow')
    expect(preToolUseDecision('Read', outside, project, 'auto')).toBe('none')
    expect(preToolUseDecision('mcp__promptsys__link_cards', {}, project, 'auto')).toBe('allow')
  })

  it('maps our modes to the SDK modes', () => {
    expect(['default', 'acceptEdits', 'plan', 'auto'].map((m) => sdkPermissionMode(m as never))).toEqual(['default', 'default', 'plan', 'auto'])
  })
})

describe('contextFromResult', () => {
  it('computes the percentage from the largest model usage', () => {
    const r = { type: 'result', modelUsage: { a: { inputTokens: 10, cacheReadInputTokens: 40_000, cacheCreationInputTokens: 9_990, contextWindow: 200_000 } } }
    expect(contextFromResult(msg(r))).toEqual({ type: 'context', percentage: 25, totalTokens: 50_000, maxTokens: 200_000 })
    expect(contextFromResult(msg({ type: 'result', modelUsage: {} }))).toBeNull()
  })
})

describe('usageFromResult', () => {
  it('maps the result usage and defaults missing fields to 0', () => {
    const r = { type: 'result', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: null } }
    expect(usageFromResult(msg(r))).toEqual({ type: 'usage', input: 10, output: 5, cacheRead: 100, cacheCreation: 0 })
    expect(usageFromResult(msg({ type: 'result' }))).toBeNull()
    expect(usageFromResult(msg({ type: 'assistant' }))).toBeNull()
  })
})

describe('planUsageFromResponse', () => {
  it('maps both windows and the subscription type', () => {
    const r = { rate_limits_available: true, subscription_type: 'max', rate_limits: { five_hour: { utilization: 34, resets_at: '2026-11-24T15:00:00Z' }, seven_day: { utilization: 12, resets_at: null } } }
    expect(planUsageFromResponse(r)).toEqual({ type: 'plan_usage', fiveHour: { utilization: 34, resetsAt: '2026-11-24T15:00:00Z' }, sevenDay: { utilization: 12, resetsAt: null }, subscriptionType: 'max' })
  })
  it('returns null when unavailable or empty', () => {
    expect(planUsageFromResponse(null)).toBeNull()
    expect(planUsageFromResponse({ rate_limits_available: false, rate_limits: null })).toBeNull()
    expect(planUsageFromResponse({ rate_limits_available: true, rate_limits: { five_hour: { utilization: null, resets_at: null } } })).toBeNull()
  })
  it('keeps only the window that has data', () => {
    expect(planUsageFromResponse({ rate_limits_available: true, subscription_type: null, rate_limits: { seven_day: { utilization: 3, resets_at: null } } })).toEqual({ type: 'plan_usage', sevenDay: { utilization: 3, resetsAt: null }, subscriptionType: null })
  })
})

describe('findClaudeExecutable', () => {
  it('prefers PROMPTSYS_CLAUDE_PATH, then PATH, then the usual install folders', () => {
    const has = (paths: string[]) => (p: string) => paths.includes(p)
    expect(findClaudeExecutable({ PROMPTSYS_CLAUDE_PATH: '/x/claude', PATH: '/usr/bin' }, has(['/x/claude', '/usr/bin/claude']), '/h')).toBe('/x/claude')
    expect(findClaudeExecutable({ PATH: '/a:/usr/bin' }, has(['/usr/bin/claude']), '/h')).toBe('/usr/bin/claude')
    expect(findClaudeExecutable({ PATH: '/usr/bin' }, has(['/h/.local/bin/claude']), '/h')).toBe('/h/.local/bin/claude')
    expect(findClaudeExecutable({}, has([]), '/h')).toBeUndefined()
  })
})

describe('hookSystemMessage', () => {
  it('returns the systemMessage of JSON hook output and ignores plain output', () => {
    expect(hookSystemMessage(JSON.stringify({ systemMessage: ' Hi /fetch-save ', hookSpecificOutput: {} }))).toBe('Hi /fetch-save')
    expect(hookSystemMessage(JSON.stringify({ hookSpecificOutput: { additionalContext: 'x' } }))).toBeNull()
    expect(hookSystemMessage('plain context for the model')).toBeNull()
    expect(hookSystemMessage('')).toBeNull()
  })
})
