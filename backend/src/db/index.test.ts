import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './index.ts'

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'promptsys-migrations-'))
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
  return dir
}

describe('openDatabase', () => {
  it('enables foreign keys', () => {
    const db = openDatabase(':memory:')
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('creates missing parent folders for file databases', () => {
    const base = mkdtempSync(join(tmpdir(), 'promptsys-db-'))
    const db = openDatabase(join(base, 'nested', 'x.db'))
    db.close()
    expect(existsSync(join(base, 'nested', 'x.db'))).toBe(true)
  })
})

describe('migrate', () => {
  it('applies migrations in order and records them', () => {
    const dir = migrationsDir({
      '0002_b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));',
      '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
    })
    const db = openDatabase(':memory:')
    expect(migrate(db, dir)).toEqual(['0001_a.sql', '0002_b.sql'])
    expect(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1, name: '0001_a.sql' },
      { version: 2, name: '0002_b.sql' },
    ])
  })

  it('is idempotent', () => {
    const dir = migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);' })
    const db = openDatabase(':memory:')
    migrate(db, dir)
    expect(migrate(db, dir)).toEqual([])
  })

  it('rolls back a failing migration and keeps earlier ones', () => {
    const dir = migrationsDir({
      '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '0002_bad.sql': 'CREATE TABLE c (id INTEGER); INSERT INTO missing VALUES (1);',
    })
    const db = openDatabase(':memory:')
    expect(() => migrate(db, dir)).toThrow(/0002_bad.sql/)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'c'").get()).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 })
  })

  it('rejects badly named and duplicate versions', () => {
    const db = openDatabase(':memory:')
    expect(() => migrate(db, migrationsDir({ 'init.sql': '' }))).toThrow(/Invalid migration file name/)
    expect(() => migrate(db, migrationsDir({ '0001_a.sql': '', '0001_b.sql': '' }))).toThrow(/Duplicate/)
  })
})
