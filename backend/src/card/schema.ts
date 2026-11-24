import { z } from 'zod'
import { idSchema } from '../common/validation.ts'

export const CARD_KINDS = ['note', 'file', 'memory', 'rule', 'search'] as const
export const LINK_KINDS = ['related', 'derived_from', 'part_of', 'contradicts'] as const

export type CardKind = (typeof CARD_KINDS)[number]
export type LinkKind = (typeof LINK_KINDS)[number]
export const REVIEW_STATUSES = ['proposed', 'confirmed', 'corrected', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

const title = z.string().trim().min(1).max(200)
const body = z.string().max(200_000)
// Folders are written like "project/api"; surrounding slashes are dropped.
export const folderPath = z
  .string()
  .max(500)
  .transform((p) => p.trim().replace(/^\/+|\/+$/g, ''))

export const createCardSchema = z.object({
  title,
  body: body.default(''),
  kind: z.enum(CARD_KINDS).default('note'),
  folderPath: folderPath.default(''),
  defaultIncluded: z.boolean().default(false),
})

export const updateCardSchema = z
  .object({
    title,
    body,
    kind: z.enum(CARD_KINDS),
    folderPath,
    defaultIncluded: z.boolean(),
    ifVersion: z.number().int().positive(),
  })
  .partial()
  .refine((v) => Object.keys(v).some((k) => k !== 'ifVersion'), 'At least one field to change is required')

export const listCardsQuerySchema = z.object({
  query: z.string().optional(),
  kind: z.enum(CARD_KINDS).optional(),
  folder: folderPath.optional(),
  includeArchived: z.enum(['true', 'false']).default('false'),
})

export const createLinkSchema = z.object({
  sourceId: idSchema,
  targetId: idSchema,
  kind: z.enum(LINK_KINDS).default('related'),
  label: z.string().trim().max(200).nullish(),
})

export const updateLinkSchema = z
  .object({ kind: z.enum(LINK_KINDS), label: z.string().trim().max(200).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')

export const graphQuerySchema = z.object({
  folder: folderPath.optional(),
  kind: z.enum(CARD_KINDS).optional(),
})

export const positionsSchema = z.object({
  positions: z.array(z.object({ id: idSchema, x: z.number().finite(), y: z.number().finite() })).max(5000),
})

export type Link = {
  id: number
  sourceId: number
  targetId: number
  kind: LinkKind
  label: string | null
  createdAt: string
}

export type CardSummary = {
  id: number
  title: string
  excerpt: string
  kind: CardKind
  folderPath: string
  defaultIncluded: boolean
  version: number
  mergedInto: number | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** `'agent'` for cards recorded by a Claude Code session, `null` for user cards. */
  origin: 'agent' | null
  reviewStatus: ReviewStatus | null
}

export type Card = Omit<CardSummary, 'excerpt'> & {
  body: string
  sourceName: string | null
  mimeType: string | null
  forkedFromId: number | null
  links: Link[]
  backlinks: Link[]
}

export type GraphNode = {
  id: number
  title: string
  kind: CardKind
  folderPath: string
  x: number | null
  y: number | null
  degree: number
  origin: 'agent' | null
  reviewStatus: ReviewStatus | null
}

export type CardVersion = { version: number; title: string; body: string; createdAt: string }

export const previewMergeSchema = z.object({
  targetId: idSchema,
  // An empty list is accepted here so that the service can answer with `invalid_merge`.
  sourceIds: z.array(idSchema).max(100),
})

export const createMergeSchema = previewMergeSchema.extend({ title, body })

export type MergePreview = { title: string; body: string; linkCount: number }

export type Merge = {
  id: number
  targetId: number
  sourceId: number
  sourceTitle: string
  targetVersionBefore: number
  createdAt: string
  undoneAt: string | null
}
