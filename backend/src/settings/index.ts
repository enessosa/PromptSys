// Non-secret settings stored in the `settings` table (key -> JSON value). The API key is never stored here.
import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { AppError } from '../common/errors.ts'
import { parseBody } from '../common/validation.ts'

const defaultModel = z.string().trim().min(1).max(100).nullable()
const accentColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a colour like #7c5cff').nullable()

/** All settings with their defaults; a stored value that no longer validates falls back to the default. */
export const settingsFields = {
  defaultModel,
  ablationRuns: z.number().int().min(1).max(10),
  baselineRuns: z.number().int().min(0).max(10),
  ablationTemperature: z.number().min(0).max(1),
  accentColor,
  mode: z.enum(['api', 'claude_code']),
  codeAuth: z.enum(['local_login', 'api_key']),
}

export type AppSettings = {
  /** `null` = use the model from the environment (`ANTHROPIC_MODEL`). */
  defaultModel: string | null
  /** `n`: ablated answers per card. */
  ablationRuns: number
  /** `k`: baseline runs (full context) that measure the noise. 0 switches the noise measurement off. */
  baselineRuns: number
  ablationTemperature: number
  /** UI accent colour as `#rrggbb`, `null` = theme default. */
  accentColor: string | null
  /** `api`: chat with exact control over the context. `claude_code`: coding-agent sessions on the user's local Claude Code. */
  mode: 'api' | 'claude_code'
  /** `local_login`: the SDK uses the local Claude Code login (`ANTHROPIC_API_KEY` is removed from its environment). */
  codeAuth: 'local_login' | 'api_key'
}

export const SETTING_DEFAULTS: AppSettings = {
  defaultModel: null,
  ablationRuns: 3,
  baselineRuns: 3,
  ablationTemperature: 0.2,
  accentColor: null,
  mode: 'api',
  codeAuth: 'local_login',
}

const updateSettingsSchema = z.object(settingsFields).partial().strict()

export function createSettingsRepository(db: DatabaseSync) {
  function get(): AppSettings {
    const stored = new Map(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key as string, r.value as string]))
    const result: Record<string, unknown> = { ...SETTING_DEFAULTS }
    for (const [key, schema] of Object.entries(settingsFields)) {
      const raw = stored.get(key)
      if (raw === undefined) continue
      try {
        const parsed = schema.safeParse(JSON.parse(raw))
        if (parsed.success) result[key] = parsed.data
      } catch {
        // unreadable value: keep the default
      }
    }
    return result as AppSettings
  }

  function update(changes: Partial<AppSettings>): AppSettings {
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) upsert.run(key, JSON.stringify(value))
    }
    return get()
  }

  return { get, update }
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>

/** `GET/PUT /api/settings`. PUT merges the given fields into the stored ones and returns all settings. */
export function settingsRoutes(db: DatabaseSync): Hono {
  const repo = createSettingsRepository(db)
  const routes = new Hono()
  routes.get('/settings', (c) => c.json(repo.get()))
  routes.put('/settings', async (c) => c.json(repo.update(await parseBody(c, updateSettingsSchema))))
  return routes
}

/** Guard for features that only exist in one mode: `409 feature_requires_api_mode` / `feature_requires_claude_code_mode`. */
export function requireMode(db: DatabaseSync, mode: AppSettings['mode']): void {
  if (createSettingsRepository(db).get().mode === mode) return
  if (mode === 'api') throw new AppError(409, 'feature_requires_api_mode', 'Only available in API mode.')
  throw new AppError(409, 'feature_requires_claude_code_mode', 'Only available in Agent mode.')
}
