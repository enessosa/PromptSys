import { z } from 'zod'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const settingsSchema = z.object({
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(8000)),
  DB_URL: z.preprocess(emptyToUndefined, z.string().default('promptsys.db')),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess(emptyToUndefined, z.string().default('claude-opus-5-5')),
  FRONTEND_DIST: z.preprocess(emptyToUndefined, z.string().optional()),
  EMBEDDING_CACHE_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
  PROMPTSYS_FAKE_LLM: z.preprocess(emptyToUndefined, z.string().optional()),
})

export type Settings = {
  port: number
  dbUrl: string
  anthropicApiKey: string | undefined
  anthropicModel: string
  /** Folder with the built frontend; if set, the backend serves it (desktop app, production). */
  frontendDist: string | undefined
  /** Folder for the local embedding model; undefined = `models/` next to the database file. */
  embeddingCacheDir: string | undefined
  /** `PROMPTSYS_FAKE_LLM=1`: use the deterministic fake LLM and embedder (end-to-end tests). `main.ts` refuses it in production. */
  fakeLlm: boolean
}

/** Reads and validates the settings. Throws a readable error if a variable is invalid. */
export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  const result = settingsSchema.safeParse(env)
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid settings: ${problems}`)
  }
  const s = result.data
  return {
    port: s.PORT,
    dbUrl: s.DB_URL,
    anthropicApiKey: s.ANTHROPIC_API_KEY,
    anthropicModel: s.ANTHROPIC_MODEL,
    frontendDist: s.FRONTEND_DIST,
    embeddingCacheDir: s.EMBEDDING_CACHE_DIR,
    fakeLlm: s.PROMPTSYS_FAKE_LLM === '1',
  }
}
