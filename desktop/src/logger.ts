import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024

/** Appends lines to a log file; at the start, a file over 5 MB is moved to `<file>.old` (one generation is kept). */
export function createLogger(file: string, label?: string) {
  mkdirSync(dirname(file), { recursive: true })
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`)
  } catch {
    // no log yet
  }
  const prefix = label ? `[${label}] ` : ''
  return {
    file,
    write(text: string): void {
      try {
        appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`)
      } catch {
        // logging must never take the app down
      }
    },
    line(message: string): void {
      this.write(`${new Date().toISOString()} ${prefix}${message}`)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>
