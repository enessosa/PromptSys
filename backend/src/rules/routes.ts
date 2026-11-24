import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { assemblePrompt } from '../assembly/index.ts'
import { createCardRepository } from '../card/repository.ts'
import { createChatRepository } from '../chat/repository.ts'
import { AppError } from '../common/errors.ts'
import { idSchema, parse, parseBody } from '../common/validation.ts'
import { transaction } from '../db/index.ts'
import type { LlmClient } from '../llm/index.ts'
import { createSettingsRepository } from '../settings/index.ts'
import { createRulesRepository } from './repository.ts'
import { updateRuleSchema } from './schema.ts'
import { extractRules } from './service.ts'

/** Derived rules (mounted under `/api`). */
export function rulesRoutes(db: DatabaseSync, llm: LlmClient | undefined): Hono {
  const repo = createRulesRepository(db)
  const chat = createChatRepository(db)
  const cards = createCardRepository(db)
  const settings = createSettingsRepository(db)
  const routes = new Hono()

  // The rules call costs one more API call per answer, so it is its own explicit endpoint (not part of the chat stream).
  routes.post('/messages/:id/rules', async (c) => {
    const messageId = parse(idSchema, c.req.param('id'))
    if (!llm) throw new AppError(424, 'api_key_missing', 'No ANTHROPIC_API_KEY is configured, so derived rules are not available.')
    const answer = chat.getMessage(messageId)
    if (answer.role !== 'assistant' || answer.parentId === null) {
      throw new AppError(400, 'validation_failed', 'Rules are derived from an answer (assistant message).', [{ path: 'id', message: 'not an assistant message' }])
    }
    if (answer.status === 'streaming' || answer.content.trim() === '') {
      throw new AppError(400, 'validation_failed', 'The answer is empty or still being generated.', [{ path: 'id', message: 'no finished answer' }])
    }
    const question = chat.getMessage(answer.parentId)
    const conversation = chat.getConversation(answer.conversationId)
    // Only the cards that were really sent count as possible sources.
    const prompt = assemblePrompt({
      systemPrompt: conversation.systemPrompt,
      cards: chat.promptCards(chat.contextOf(question.id)),
      history: [],
      userContent: question.content,
    })
    const sent = chat.promptCards(chat.contextOf(question.id)).filter((card) => prompt.cardIds.includes(card.id))

    const extraction = await extractRules(llm, {
      model: answer.model ?? conversation.model ?? settings.get().defaultModel ?? llm.model,
      answer: answer.content,
      question: question.content,
      cards: sent,
    })
    const rules = transaction(db, () => repo.replaceProposed(conversation.id, messageId, extraction.rules))
    return c.json({ rules, ...(extraction.warning ? { warning: extraction.warning } : {}) })
  })

  routes.get('/conversations/:id/rules', (c) => {
    const id = parse(idSchema, c.req.param('id'))
    chat.getConversation(id)
    return c.json(repo.forConversation(id, c.req.query('includeRejected') === 'true'))
  })

  routes.patch('/rules/:id', async (c) => {
    const id = parse(idSchema, c.req.param('id'))
    const body = await parseBody(c, updateRuleSchema)
    const rule = repo.get(id)
    if (rule.status === 'corrected') {
      throw new AppError(400, 'validation_failed', 'This rule was already corrected; edit its rule card instead.', [{ path: 'status', message: 'already corrected' }])
    }
    if (body.status !== 'corrected') return c.json({ rule: repo.setStatus(id, body.status) })
    const created = transaction(db, () => repo.createRuleCard(rule, body.text, 'corrected'))
    return c.json({ rule: created.rule, card: cards.get(created.cardId) })
  })

  // "Save as card" for a confirmed rule: the rule stays `confirmed`, a rule card is created on demand.
  routes.post('/rules/:id/card', (c) => {
    const id = parse(idSchema, c.req.param('id'))
    const rule = repo.get(id)
    if (rule.status !== 'confirmed') {
      throw new AppError(400, 'validation_failed', 'Only a confirmed rule can be saved as a card.', [{ path: 'status', message: `rule is ${rule.status}` }])
    }
    if (rule.cardId !== null) {
      throw new AppError(400, 'validation_failed', `This rule is already saved as card c${rule.cardId}.`, [{ path: 'id', message: 'already saved' }])
    }
    const created = transaction(db, () => repo.createRuleCard(rule, rule.text, 'confirmed'))
    return c.json({ rule: created.rule, card: cards.get(created.cardId) }, 201)
  })

  return routes
}
