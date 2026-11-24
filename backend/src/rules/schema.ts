import { z } from 'zod'

export const RULE_STATUSES = ['proposed', 'confirmed', 'corrected', 'rejected'] as const
export type RuleStatus = (typeof RULE_STATUSES)[number]

/** A rule as sent to the frontend. The source is what the model claims, not something that was measured. */
export type DerivedRule = {
  id: number
  conversationId: number
  messageId: number
  text: string
  status: RuleStatus
  source: { kind: 'card' | 'prior_knowledge'; cardId: number | null; reliability: 'claimed' }
  /** Rule card created by a correction or by "save as card". */
  cardId: number | null
  createdAt: string
}

export const MAX_RULE_TEXT = 2000
export const MAX_RULES = 20

const ruleText = z.string().trim().min(1).max(MAX_RULE_TEXT)

export const updateRuleSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['confirmed', 'rejected']) }),
  z.object({ status: z.literal('corrected'), text: ruleText }),
])

/** The JSON schema of the `report_rules` tool. */
export const REPORT_RULES_TOOL = {
  name: 'report_rules',
  description:
    'Report the rules (facts, conventions, constraints) that the answer relied on. One entry per rule, phrased as a short general statement. Report an empty list if the answer relied on no rule.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The rule as a short, self-contained statement.' },
            source: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['card', 'prior_knowledge'], description: 'card: taken from a context card; prior_knowledge: from the model itself.' },
                cardId: { type: 'integer', description: 'Number of the card (c3 -> 3). Only for kind "card".' },
              },
              required: ['kind'],
            },
          },
          required: ['text', 'source'],
        },
      },
    },
    required: ['rules'],
  },
}

/** One entry of the tool output; entries that do not fit are skipped one by one. `cardId` may be `3` or `"c3"`. */
export const toolRuleSchema = z.object({
  text: ruleText,
  source: z.object({
    kind: z.enum(['card', 'prior_knowledge']),
    cardId: z
      .union([z.number().int().positive(), z.string().regex(/^c?\d{1,9}$/).transform((s) => Number(s.replace('c', '')))])
      .optional(),
  }),
})
