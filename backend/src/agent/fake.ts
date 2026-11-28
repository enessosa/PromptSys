// A deterministic agent without network, for tests and end-to-end tests (`PROMPTSYS_FAKE_AGENT=1`). It never touches the disk.
import type { AgentEvent, AgentRunner, TurnInput } from './runner.ts'

export function createFakeRunner(): AgentRunner {
  let counter = 0
  return {
    async available() {
      return { ok: true }
    },
    async probe() {
      return { commands: ['save', 'plantuml'], notices: [] }
    },
    async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
      const sdkSessionId = input.resume ?? `fake-${++counter}`
      // The card block that PromptSys prepends is not part of what the user typed.
      const typed = input.prompt.replace(/^<promptsys-cards>[\s\S]*?<\/promptsys-cards>\s*/, '')
      yield { type: 'init', sdkSessionId, model: 'fake-model', slashCommands: ['save', 'plantuml'] }
      yield { type: 'text', text: `Working on: ${typed}${input.images?.length ? ` (${input.images.length} image${input.images.length > 1 ? 's' : ''})` : ''}` }
      try {
        await input.cardTools.recordCard({ title: `Understanding: ${typed.slice(0, 40)}`, body: `The task was: ${typed}` })
      } catch {
        // Like the real agent, which gets the refusal (e.g. a rejected term) as a tool error and carries on.
      }
      if (input.signal.aborted) return
      if (typed.includes('edit')) {
        const toolInput = { file_path: 'README.md' }
        const mode = input.getPermissionMode()
        // Like the real gate: "Accept edits" and "Auto" run the edit without asking.
        const decision = mode === 'acceptEdits' || mode === 'auto' ? { allow: true } : await input.approve({ toolName: 'Edit', input: toolInput })
        if (input.signal.aborted) return
        if (decision.allow) {
          yield { type: 'tool_call', id: 'fake-tool-1', name: 'Edit', input: toolInput }
          yield { type: 'tool_result', id: 'fake-tool-1', isError: false, summary: 'Edited README.md (fake)' }
        } else {
          yield { type: 'text', text: 'Edit was denied' }
        }
      }
      if (typed.includes('question')) {
        const question = 'Which database should we use?'
        const toolInput = { questions: [{ question, header: 'Database', multiSelect: false, options: [{ label: 'SQLite', description: 'One file' }, { label: 'Postgres', description: 'A server' }] }] }
        const answer = await input.approve({ toolName: 'AskUserQuestion', input: toolInput })
        if (input.signal.aborted) return
        yield { type: 'text', text: answer.allow ? `You chose: ${answer.answers?.[question] ?? '(nothing)'}` : 'No answer' }
      }
      if (typed.includes('plan')) {
        const answer = await input.approve({ toolName: 'ExitPlanMode', input: { plan: '1. Add the table\n2. Write the test' } })
        if (input.signal.aborted) return
        yield { type: 'text', text: answer.allow ? `Plan approved, mode ${input.getPermissionMode()}` : `Keep planning: ${answer.message ?? ''}` }
      }
      if (typed.includes('agent')) {
        const input = { description: 'Explore the repo', subagent_type: 'Explore', prompt: 'Find the build scripts' }
        yield { type: 'tool_call', id: 'fake-agent-1', name: 'Agent', input }
        yield { type: 'text', text: 'Looking at package.json', parentToolUseId: 'fake-agent-1' }
        yield { type: 'tool_call', id: 'fake-sub-1', name: 'Read', input: { file_path: 'package.json' }, parentToolUseId: 'fake-agent-1' }
        yield { type: 'tool_result', id: 'fake-sub-1', isError: false, summary: '{ "scripts": {} }', parentToolUseId: 'fake-agent-1' }
        yield { type: 'tool_result', id: 'fake-agent-1', isError: false, summary: 'Build scripts live in package.json (fake)' }
      }
      yield { type: 'result', isError: false, costUsd: 0, durationMs: 1 }
      yield { type: 'context', percentage: 12.5, totalTokens: 25_000, maxTokens: 200_000 }
      yield { type: 'usage', input: 1_200, output: 800, cacheRead: 20_000, cacheCreation: 3_000 }
      yield { type: 'plan_usage', fiveHour: { utilization: 34, resetsAt: '2026-11-24T18:00:00.000Z' }, sevenDay: { utilization: 12, resetsAt: '2026-11-30T09:00:00.000Z' }, subscriptionType: 'max' }
    },
  }
}
