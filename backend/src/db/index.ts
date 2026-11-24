import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Default folder with the numbered `.sql` migration files (`backend/migrations`). */
export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')

/**
 * Opens a SQLite database (a file path or `:memory:`) with foreign keys enabled.
 * `PRAGMA foreign_keys` is per connection, so it has to be set here every time.
 */
export function openDatabase(url: string): DatabaseSync {
  if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true })
  const db = new DatabaseSync(url)
  db.exec('PRAGMA foreign_keys = ON')
  if (url !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  return db
}

type MigrationFile = { version: number; name: string; sql: string }

const FILE_PATTERN = /^(\d+)_.+\.sql$/

function readMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((name) => {
      const match = FILE_PATTERN.exec(name)
      if (!match) throw new Error(`Invalid migration file name "${name}" (expected 0001_description.sql)`)
      return { version: Number(match[1]), name, sql: readFileSync(join(dir, name), 'utf8') }
    })
    .sort((a, b) => a.version - b.version)
  for (let i = 1; i < files.length; i++) {
    if (files[i].version === files[i - 1].version) {
      throw new Error(`Duplicate migration version ${files[i].version}`)
    }
  }
  return files
}

/**
 * Applies all migrations that are not yet recorded in `schema_migrations`, in order.
 * Each migration runs in its own transaction; a failing one is rolled back and rethrown.
 * Returns the names of the migrations applied by this call.
 */
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`)
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)),
  )
  const done: string[] = []
  for (const m of readMigrations(dir)) {
    if (applied.has(m.version)) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${m.name} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    }
    done.push(m.name)
  }
  return done
}

/** Runs `fn` in one transaction: commit if it returns, roll back if it throws. Keep it short and never call the LLM inside. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
