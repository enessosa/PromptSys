import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The part of Electron's `safeStorage` we use; tests pass a fake. */
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only: `basic_text` means no real keyring, i.e. effectively plain text. */
  getSelectedStorageBackend?(): string
}

export class KeyStoreUnavailableError extends Error {
  constructor() {
    super('Secure storage is not available on this system, so the API key is not stored.')
  }
}

/** Cleans up what the user pasted. */
export function normalizeApiKey(raw: string): string {
  return raw.trim()
}

/** Very light plausibility check (the API decides whether the key is valid). */
export function isPlausibleApiKey(key: string): boolean {
  return key.length >= 20 && key.length <= 400 && !/\s/.test(key)
}

/** Stores the Anthropic API key encrypted with the OS keychain; never writes the key in plain text. Main process only. */
export function createKeyStore(safeStorage: SafeStorageLike, file: string) {
  const usable = () =>
    safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  return {
    isAvailable: usable,
    has(): boolean {
      return existsSync(file)
    },
    get(): string | undefined {
      if (!existsSync(file) || !usable()) return undefined
      try {
        return safeStorage.decryptString(readFileSync(file))
      } catch {
        return undefined
      }
    },
    set(key: string): void {
      if (!usable()) throw new KeyStoreUnavailableError()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 })
      try {
        chmodSync(file, 0o600)
      } catch {
        // not supported on every file system
      }
    },
    clear(): void {
      rmSync(file, { force: true })
    },
  }
}

export type KeyStore = ReturnType<typeof createKeyStore>
