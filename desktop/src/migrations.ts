import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** Migration file names look like `0004_replay.sql`; returns the version numbers. */
export function migrationVersions(dir: string): number[] {
  return readdirSync(dir)
    .map((name) => /^(\d+)_.+\.sql$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
}

/**
 * Back up only when there is something to lose and something will change: the database already has migrations
 * applied (a brand-new or empty file needs no backup) and at least one available migration is still missing.
 */
export function needsBackup(input: { dbExists: boolean; applied: readonly number[]; available: readonly number[] }): boolean {
  if (!input.dbExists || input.applied.length === 0) return false
  const applied = new Set(input.applied)
  return input.available.some((v) => !applied.has(v))
}

/** Versions recorded in `schema_migrations`; empty if the table does not exist yet. */
export function readAppliedVersions(dbPath: string): number[] {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const table = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
    if (!table) return []
    return db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version))
  } finally {
    db.close()
  }
}

/**
 * Before the backend applies new migrations: copy the database to `<db>.bak` (replacing an older backup).
 * Uses `VACUUM INTO`, which writes a consistent single-file copy even if the WAL file holds recent changes.
 * Returns the backup path, or undefined if no backup was needed. Throws if the backup fails (then do not migrate).
 */
export function backupBeforeMigrate(dbPath: string, migrationsDir: string): string | undefined {
  const dbExists = existsSync(dbPath)
  const available = migrationVersions(migrationsDir)
  const applied = dbExists ? readAppliedVersions(dbPath) : []
  if (!needsBackup({ dbExists, applied, available })) return undefined
  const backupPath = `${dbPath}.bak`
  const tmpPath = `${backupPath}.tmp`
  rmSync(tmpPath, { force: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare('VACUUM INTO ?').run(tmpPath)
  } finally {
    db.close()
  }
  copyFileSync(tmpPath, backupPath)
  rmSync(tmpPath, { force: true })
  return backupPath
}
