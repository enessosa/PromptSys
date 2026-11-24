// Access to the Claude API via the Anthropic SDK, including the check whether an API key is configured.
import Anthropic, {
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  GatewayTimeoutError,
  RateLimitError,
  RequestTimeoutError,
} from '@anthropic-ai/sdk'
import type { Settings } from '../common/config.ts'
import { AppError } from '../common/errors.ts'

export type LlmMessage = { role: 'user' | 'assistant'; content: string }
export type LlmRequest = {
  system?: string
  messages: LlmMessage[]
  /** Overrides the default model from the settings (e.g. the model chosen for a conversation). */
  model?: string
  maxTokens?: number
  /** Sampling temperature (0..1); omitted = the API default. Ablation sets a low value to reduce noise. */
  temperature?: number
}

/** A request that forces the model to answer by calling one tool (structured output, e.g. `report_rules`). */
export type LlmToolRequest = LlmRequest & {
  tool: { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }
}

/** One step of a streamed answer: a piece of text, and at the very end the usage and the stop reason. */
export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: string | null; inputTokens: number | null; outputTokens: number | null }

/** The part of the Claude API the backend needs. Tests replace it with a stub, so no real API calls are made. */
export type LlmClient = {
  /** The default model (used when a conversation has none of its own). */
  model: string
  complete(request: LlmRequest): Promise<{ text: string; inputTokens?: number | null; outputTokens?: number | null }>
  /** Forces a call of `request.tool`; `input` is what the model passed to it (unvalidated), `null` if it made no tool call. */
  callTool(request: LlmToolRequest): Promise<{ input: unknown }>
  /**
   * Streams the answer. Ends with exactly one `done` event. When `signal` is aborted the iterable throws
   * (the caller checks `signal.aborted`); other failures are thrown as `AppError` (`llm_*` codes).
   */
  stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<LlmStreamEvent>
}

/** Maps an Anthropic SDK error to the API error format (429 / 502 / 504). */
export function toLlmError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof RateLimitError) return new AppError(429, 'llm_rate_limited', 'The Claude API rate limit was reached. Try again in a moment.')
  if (err instanceof APIConnectionTimeoutError || err instanceof RequestTimeoutError || err instanceof GatewayTimeoutError) {
    return new AppError(504, 'llm_timeout', 'The Claude API did not answer in time.')
  }
  if (err instanceof AuthenticationError) return new AppError(502, 'llm_error', 'The Claude API rejected the API key.')
  if (err instanceof APIError) return new AppError(502, 'llm_error', `The Claude API returned an error${err.status ? ` (${err.status})` : ''}.`)
  console.error('Unexpected LLM failure', err)
  return new AppError(502, 'llm_error', 'The Claude API request failed.')
}

/** Returns the real client, or `undefined` if no API key is configured (chat and ablation are then disabled). */
export function createLlmClient(settings: Settings): LlmClient | undefined {
  if (!settings.anthropicApiKey) return undefined
  const anthropic = new Anthropic({ apiKey: settings.anthropicApiKey })
  const params = (request: LlmRequest) => ({
    model: request.model ?? settings.anthropicModel,
    max_tokens: request.maxTokens ?? 4096,
    system: request.system,
    messages: request.messages,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  })
  return {
    model: settings.anthropicModel,
    async complete(request) {
      try {
        const response = await anthropic.messages.create(params(request))
        const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
        return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      } catch (err) {
        throw toLlmError(err)
      }
    },
    async callTool(request) {
      try {
        const { tool } = request
        const response = await anthropic.messages.create({
          ...params(request),
          tools: [{ name: tool.name, description: tool.description, input_schema: tool.inputSchema }],
          tool_choice: { type: 'tool', name: tool.name },
        })
        const block = response.content.find((b) => b.type === 'tool_use' && b.name === tool.name)
        return { input: block?.type === 'tool_use' ? block.input : null }
      } catch (err) {
        throw toLlmError(err)
      }
    },
    async *stream(request, signal) {
      let inputTokens: number | null = null
      let outputTokens: number | null = null
      let stopReason: string | null = null
      try {
        const events = await anthropic.messages.create({ ...params(request), stream: true }, { signal })
        for await (const event of events) {
          if (event.type === 'message_start') {
            inputTokens = event.message.usage.input_tokens
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          } else if (event.type === 'message_delta') {
            stopReason = event.delta.stop_reason ?? stopReason
            outputTokens = event.usage.output_tokens
          }
        }
      } catch (err) {
        if (signal.aborted) throw err
        throw toLlmError(err)
      }
      yield { type: 'done', stopReason, inputTokens, outputTokens }
    },
  }
}
