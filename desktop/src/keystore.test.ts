import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createKeyStore, isPlausibleApiKey, KeyStoreUnavailableError, normalizeApiKey, type SafeStorageLike } from './keystore'

/** Fake "encryption": reversible, but the bytes on disk clearly differ from the plain text. */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from([...Buffer.from(plain)].map((b) => b ^ 0x5a)),
    decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString(),
    ...overrides,
  }
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'promptsys-key-')), 'nested', 'api-key.bin')
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'

describe('key store', () => {
  it('stores the key encrypted and reads it back', () => {
    const file = tmpFile()
    const store = createKeyStore(fakeSafeStorage(), file)
    expect(store.has()).toBe(false)
    store.set(KEY)
    expect(store.has()).toBe(true)
    expect(readFileSync(file).toString()).not.toContain('sk-ant')
    expect(store.get()).toBe(KEY)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0)
  })

  it('clear removes the key', () => {
    const file = tmpFile()
    const store = createKeyStore(fakeSafeStorage(), file)
    store.set(KEY)
    store.clear()
    expect(store.has()).toBe(false)
    expect(store.get()).toBeUndefined()
    expect(existsSync(file)).toBe(false)
  })

  it('refuses to store when encryption is not available', () => {
    const file = tmpFile()
    const store = createKeyStore(fakeSafeStorage({ isEncryptionAvailable: () => false }), file)
    expect(() => store.set(KEY)).toThrow(KeyStoreUnavailableError)
    expect(existsSync(file)).toBe(false)
  })

  it('treats the Linux plain-text backend as unavailable', () => {
    const store = createKeyStore(fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }), tmpFile())
    expect(store.isAvailable()).toBe(false)
    expect(() => store.set(KEY)).toThrow(KeyStoreUnavailableError)
  })

  it('returns undefined if the stored data cannot be decrypted', () => {
    const file = tmpFile()
    createKeyStore(fakeSafeStorage(), file).set(KEY)
    const broken = createKeyStore(fakeSafeStorage({ decryptString: () => { throw new Error('bad keychain') } }), file)
    expect(broken.get()).toBeUndefined()
  })
})

describe('key helpers', () => {
  it('trims pasted keys', () => {
    expect(normalizeApiKey(`  ${KEY}\n`)).toBe(KEY)
  })
  it('checks plausibility', () => {
    expect(isPlausibleApiKey(KEY)).toBe(true)
    expect(isPlausibleApiKey('short')).toBe(false)
    expect(isPlausibleApiKey(`${KEY} with space`)).toBe(false)
  })
})
