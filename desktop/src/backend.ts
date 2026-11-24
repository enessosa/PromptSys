import { utilityProcess, type UtilityProcess } from 'electron'
import type { Logger } from './logger'

export type BackendOptions = {
  entry: string
  log: Logger
  /** Called when the process ends without `stop()` having been called. */
  onUnexpectedExit: (code: number | null) => void
}

/** Runs the compiled backend in an Electron utility process (a separate Node process, so a crash does not take the window down). */
export function createBackendProcess({ entry, log, onUnexpectedExit }: BackendOptions) {
  let child: UtilityProcess | undefined
  let exited: Promise<void> = Promise.resolve()
  let stopRequested = false

  return {
    isAlive: () => child !== undefined,
    start(env: Record<string, string>): void {
      if (child) throw new Error('Backend is already running')
      const proc = utilityProcess.fork(entry, [], { env, stdio: 'pipe', serviceName: 'PromptSys backend' })
      child = proc
      log.line(`backend starting, entry ${entry}`)
      proc.stdout?.on('data', (d: Buffer) => log.write(d.toString()))
      proc.stderr?.on('data', (d: Buffer) => log.write(d.toString()))
      proc.once('spawn', () => log.line(`backend spawned (pid ${proc.pid})`))
      let resolveExit!: () => void
      exited = new Promise((resolve) => (resolveExit = resolve))
      stopRequested = false
      proc.once('exit', (code) => {
        log.line(`backend exited with code ${code}`)
        if (child === proc) child = undefined
        resolveExit()
        if (!stopRequested) onUnexpectedExit(code)
      })
    },
    /** Stops the process and waits until it is gone (hard kill after 5 s). */
    async stop(): Promise<void> {
      const proc = child
      if (!proc) return
      stopRequested = true
      proc.kill()
      const timer = setTimeout(() => process.kill(proc.pid ?? 0, 'SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
    },
  }
}

export type BackendProcess = ReturnType<typeof createBackendProcess>
