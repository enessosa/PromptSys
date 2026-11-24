import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { backupBeforeMigrate, migrationVersions, needsBackup } from './migrations'

describe('needsBackup', () => {
  it('is false without a database', () => {
    expect(needsBackup({ dbExists: false, applied: [], available: [1, 2] })).toBe(false)
  })
  it('is false for a database without applied migrations (new file)', () => {
    expect(needsBackup({ dbExists: true, applied: [], available: [1, 2] })).toBe(false)
  })
  it('is false when everything is applied', () => {
    expect(needsBackup({ dbExists: true, applied: [1, 2], available: [1, 2] })).toBe(false)
  })
  it('is true when a migration is pending on an existing database', () => {
    expect(needsBackup({ dbExists: true, applied: [1, 2], available: [1, 2, 3] })).toBe(true)
  })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'promptsys-mig-'))
  const migrations = join(dir, 'migrations')
  mkdirSync(migrations)
  for (const n of ['0001_a.sql', '0002_b.sql']) writeFileSync(join(migrations, n), 'SELECT 1;')
  writeFileSync(join(migrations, 'notes.txt'), 'ignored')
  return { dir, migrations, db: join(dir, 'promptsys.db') }
}

function createDb(path: string, versions: number[]) {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)')
  db.exec('CREATE TABLE cards (id INTEGER PRIMARY KEY, title TEXT)')
  db.exec("INSERT INTO cards (title) VALUES ('hello')")
  for (const v of versions) db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(v, `m${v}`)
  db.close()
}

describe('backupBeforeMigrate', () => {
  it('lists migration versions', () => {
    expect(migrationVersions(setup().migrations)).toEqual([1, 2])
  })

  it('copies the database to .bak when a migration is pending', () => {
    const { db, migrations } = setup()
    createDb(db, [1])
    const backup = backupBeforeMigrate(db, migrations)
    expect(backup).toBe(`${db}.bak`)
    const copy = new DatabaseSync(`${db}.bak`, { readOnly: true })
    expect(copy.prepare('SELECT title FROM cards').get()).toMatchObject({ title: 'hello' })
    copy.close()
  })

  it('replaces an older backup', () => {
    const { db, migrations } = setup()
    createDb(db, [1])
    backupBeforeMigrate(db, migrations)
    const conn = new DatabaseSync(db)
    conn.exec("INSERT INTO cards (title) VALUES ('second')")
    conn.close()
    backupBeforeMigrate(db, migrations)
    const copy = new DatabaseSync(`${db}.bak`, { readOnly: true })
    expect(copy.prepare('SELECT count(*) AS n FROM cards').get()).toMatchObject({ n: 2 })
    copy.close()
  })

  it('does nothing when up to date or when there is no database', () => {
    const { db, migrations } = setup()
    expect(backupBeforeMigrate(db, migrations)).toBeUndefined()
    createDb(db, [1, 2])
    expect(backupBeforeMigrate(db, migrations)).toBeUndefined()
    expect(existsSync(`${db}.bak`)).toBe(false)
  })
})
