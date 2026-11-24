// Similarity ablation: regenerate the answer without one card, compare it with the original via embeddings,
// store every run. No database transaction is open while waiting for the LLM or the embedding model.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { assemblePrompt, type AssembledPrompt } from '../assembly/index.ts'
import { createChatRepository } from '../chat/repository.ts'
import { AppError } from '../common/errors.ts'
import type { LlmClient } from '../llm/index.ts'
import { createSettingsRepository } from '../settings/index.ts'
import type { Embedder } from './embedding.ts'
import { cosine, NO_EFFECT_TEXT, scoreCard, type AblationLabel } from './score.ts'

export type AblationRequest = { cardIds: number[]; runs?: number; baselineRuns?: number }

export type AblationPlan = {
  messageId: number
  cardIds: number[]
  /** `n`: runs per card. */
  runs: number
  /** `k`: baseline runs wanted. */
  baselineRuns: number
  /** Baseline runs that already exist for this answer and are reused. */
  reusedBaselineRuns: number
  /** `k + n x cards` (minus reused baseline runs). */
  estimatedApiCalls: number
}

type ReadyPlan = AblationPlan & {
  original: string
  model: string
  temperature: number
  baselinePrompt: AssembledPrompt
  cardPrompts: Map<number, AssembledPrompt>
}

export type CardResult = {
  cardId: number
  /** Number of ablated runs behind the numbers. */
  runs: number
  change: number
  /** Noise floor from the baseline runs (0 if none were run, see `noiseMeasured`). */
  noise: number
  noiseMeasured: boolean
  effect: number
  label: AblationLabel
  /** Plain-language reading; for `within_noise` it says that the ablation cannot tell why there is no effect. */
  explanation: string
  answers: { runIndex: number; answer: string; similarity: number | null }[]
}

export type AblationResults = {
  messageId: number
  baseline: { runs: number; noise: number | null; answers: { runIndex: number; answer: string; similarity: number | null }[] }
  cards: CardResult[]
}

export type ProgressEvent = { done: number; total: number; cardId?: number }

export type AblationHooks = {
  onProgress(event: ProgressEvent): Promise<void> | void
  onResult(result: CardResult): Promise<void> | void
  /** Checked between runs; the ablation stops quietly when it returns true (client gone). */
  isAborted(): boolean
}

type RunRow = { runIndex: number; answer: string; similarity: number | null }

export function createAblationService(db: DatabaseSync, llm: LlmClient | undefined, embedder: Embedder) {
  const chat = createChatRepository(db)
  const settings = createSettingsRepository(db)
  const running = new Set<number>()

  function requireLlm(): LlmClient {
    if (!llm) throw new AppError(424, 'api_key_missing', 'No ANTHROPIC_API_KEY is configured, so ablation is not available.')
    return llm
  }

  function answerOf(messageId: number) {
    const answer = chat.getMessage(messageId)
    if (answer.role !== 'assistant' || answer.parentId === null) {
      throw new AppError(400, 'validation_failed', 'Ablation needs an answer (assistant message).', [{ path: 'id', message: 'not an assistant message' }])
    }
    return answer
  }

  const runsOf = (messageId: number, cardId: number | null): RunRow[] =>
    db
      .prepare(`SELECT run_index, answer, similarity FROM ablation_runs WHERE message_id = ? AND card_id ${cardId === null ? 'IS NULL' : '= ?'} ORDER BY run_index`)
      .all(...([messageId, ...(cardId === null ? [] : [cardId])] as SQLInputValue[]))
      .map((r) => ({ runIndex: r.run_index as number, answer: r.answer as string, similarity: r.similarity as number | null }))

  /** Validates the request and builds the prompts. Throws before anything is sent to the model. */
  function prepare(messageId: number, request: AblationRequest): ReadyPlan {
    const client = requireLlm()
    const answer = answerOf(messageId)
    if (answer.status === 'streaming' || answer.content.trim() === '') {
      throw new AppError(400, 'validation_failed', 'The answer is empty or still being generated.', [{ path: 'id', message: 'no finished answer' }])
    }
    const question = chat.getMessage(answer.parentId as number)
    const conversation = chat.getConversation(answer.conversationId)
    const current = settings.get()

    const base = {
      systemPrompt: conversation.systemPrompt,
      history: chat.historyOf(question.parentId),
      userContent: question.content,
    }
    const cards = chat.promptCards(chat.contextOf(question.id))
    const baselinePrompt = assemblePrompt({ ...base, cards })
    const cardPrompts = new Map<number, AssembledPrompt>()
    for (const cardId of request.cardIds) {
      if (!baselinePrompt.cardIds.includes(cardId)) {
        throw new AppError(400, 'validation_failed', `Card c${cardId} was not sent with the question of this answer.`, [{ path: 'cardIds', message: `c${cardId} not sent` }])
      }
      cardPrompts.set(cardId, assemblePrompt({ ...base, cards: cards.filter((c) => c.id !== cardId) }))
    }

    const runs = request.runs ?? current.ablationRuns
    const baselineRuns = request.baselineRuns ?? current.baselineRuns
    const reusedBaselineRuns = Math.min(baselineRuns, runsOf(messageId, null).length)
    return {
      messageId,
      cardIds: request.cardIds,
      runs,
      baselineRuns,
      reusedBaselineRuns,
      estimatedApiCalls: baselineRuns - reusedBaselineRuns + runs * request.cardIds.length,
      original: answer.content,
      model: answer.model ?? conversation.model ?? current.defaultModel ?? client.model,
      temperature: current.ablationTemperature,
      baselinePrompt,
      cardPrompts,
    }
  }

  const publicPlan = (p: ReadyPlan): AblationPlan => ({
    messageId: p.messageId,
    cardIds: p.cardIds,
    runs: p.runs,
    baselineRuns: p.baselineRuns,
    reusedBaselineRuns: p.reusedBaselineRuns,
    estimatedApiCalls: p.estimatedApiCalls,
  })

  async function embed(texts: string[]): Promise<number[][]> {
    try {
      return await embedder.embed(texts)
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError(502, 'internal_error', `The local embedding model failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function resultOf(messageId: number, cardId: number): CardResult | null {
    const rows = runsOf(messageId, cardId)
    const sims = (list: RunRow[]) => list.flatMap((r) => (r.similarity === null ? [] : [r.similarity]))
    const score = scoreCard(sims(rows), sims(runsOf(messageId, null)))
    if (!score) return null
    return {
      cardId,
      runs: rows.length,
      ...score,
      explanation: score.label === 'within_noise' ? NO_EFFECT_TEXT : score.label === 'strong' ? 'The answer changes clearly without this card.' : 'The answer changes a little without this card.',
      answers: rows,
    }
  }

  function results(messageId: number): AblationResults {
    answerOf(messageId)
    const baselineRows = runsOf(messageId, null)
    const baselineSims = baselineRows.flatMap((r) => (r.similarity === null ? [] : [r.similarity]))
    const cardIds = db
      .prepare('SELECT DISTINCT card_id FROM ablation_runs WHERE message_id = ? AND card_id IS NOT NULL ORDER BY card_id')
      .all(messageId)
      .map((r) => r.card_id as number)
    return {
      messageId,
      baseline: {
        runs: baselineRows.length,
        noise: baselineSims.length === 0 ? null : 1 - baselineSims.reduce((s, v) => s + v, 0) / baselineSims.length,
        answers: baselineRows,
      },
      cards: cardIds.flatMap((id) => resultOf(messageId, id) ?? []),
    }
  }

  /** Runs the whole plan: baseline first (the noise is needed for every card), then the cards one after another. */
  async function execute(plan: ReadyPlan, hooks: AblationHooks): Promise<{ apiCalls: number }> {
    const client = requireLlm()
    if (running.has(plan.messageId)) throw new AppError(409, 'generation_running', 'An ablation of this answer is already running.')
    running.add(plan.messageId)
    try {
      // The original is embedded first, so a broken embedding model fails before any API call is spent.
      const [originalVector] = await embed([plan.original])
      let done = 0
      const total = plan.estimatedApiCalls

      const runOnce = async (prompt: AssembledPrompt, cardId: number | null, runIndex: number) => {
        const reply = await client.complete({
          system: prompt.system,
          messages: prompt.messages,
          model: plan.model,
          temperature: plan.temperature,
        })
        const [vector] = await embed([reply.text])
        db.prepare(
          `INSERT INTO ablation_runs (message_id, card_id, run_index, answer, similarity, temperature, model, input_tokens, output_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(plan.messageId, cardId, runIndex, reply.text, cosine(originalVector, vector), plan.temperature, plan.model, reply.inputTokens ?? null, reply.outputTokens ?? null)
        done++
        await hooks.onProgress({ done, total, ...(cardId === null ? {} : { cardId }) })
      }

      const existingBaseline = runsOf(plan.messageId, null)
      let nextIndex = existingBaseline.reduce((max, r) => Math.max(max, r.runIndex), 0) + 1
      for (let i = plan.reusedBaselineRuns; i < plan.baselineRuns; i++) {
        if (hooks.isAborted()) return { apiCalls: done }
        await runOnce(plan.baselinePrompt, null, nextIndex++)
      }
      for (const cardId of plan.cardIds) {
        // A new ablation of a card replaces its earlier runs.
        db.prepare('DELETE FROM ablation_runs WHERE message_id = ? AND card_id = ?').run(plan.messageId, cardId)
        const prompt = plan.cardPrompts.get(cardId) as AssembledPrompt
        for (let i = 1; i <= plan.runs; i++) {
          if (hooks.isAborted()) return { apiCalls: done }
          await runOnce(prompt, cardId, i)
        }
        const result = resultOf(plan.messageId, cardId)
        if (result) await hooks.onResult(result)
      }
      return { apiCalls: done }
    } finally {
      running.delete(plan.messageId)
    }
  }

  return { prepare, publicPlan, execute, results }
}

export type AblationService = ReturnType<typeof createAblationService>
