import { join } from 'node:path'

export type ResourcePaths = {
  /** `backend/dist/main.js`: the compiled backend. */
  backendEntry: string
  /** Folder with the numbered `.sql` files (the backend finds them itself next to `dist/`; used for the backup decision). */
  migrationsDir: string
  /** Built frontend (`index.html` inside). */
  frontendDist: string
}

export type DataPaths = {
  dbFile: string
  modelsDir: string
  logDir: string
  backendLog: string
  mainLog: string
  apiKeyFile: string
}

/**
 * Where the bundled backend and frontend live.
 * Packaged: `<Resources>/backend` and `<Resources>/frontend` (electron-builder `extraResources`).
 * Development: the sibling `backend/` and `frontend/` folders of the repository.
 */
export function resourcePaths(options: { packaged: boolean; resourcesPath: string; repoRoot: string }): ResourcePaths {
  const backendRoot = options.packaged ? join(options.resourcesPath, 'backend') : join(options.repoRoot, 'backend')
  const frontendDist = options.packaged ? join(options.resourcesPath, 'frontend') : join(options.repoRoot, 'frontend', 'dist')
  return { backendEntry: join(backendRoot, 'dist', 'main.js'), migrationsDir: join(backendRoot, 'migrations'), frontendDist }
}

/** Everything the app writes lives under Electron's `userData` folder. */
export function dataPaths(userData: string): DataPaths {
  const logDir = join(userData, 'logs')
  return {
    dbFile: join(userData, 'promptsys.db'),
    modelsDir: join(userData, 'models'),
    logDir,
    backendLog: join(logDir, 'backend.log'),
    mainLog: join(logDir, 'main.log'),
    apiKeyFile: join(userData, 'api-key.bin'),
  }
}

/** Environment for the backend process. Explicit allowlist: the app's own environment (and any stray API key in it) is not inherited. */
export function backendEnv(input: {
  port: number
  paths: DataPaths
  frontendDist: string
  apiKey: string | undefined
  parentEnv: Record<string, string | undefined>
}): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: String(input.port),
    DB_URL: input.paths.dbFile,
    FRONTEND_DIST: input.frontendDist,
    EMBEDDING_CACHE_DIR: input.paths.modelsDir,
  }
  // USER/LOGNAME: Claude Code (code mode) finds the user's login in the macOS keychain by user name.
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'CLAUDE_CONFIG_DIR', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'ANTHROPIC_MODEL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
    const value = input.parentEnv[name]
    if (value) env[name] = value
  }
  if (input.apiKey) env.ANTHROPIC_API_KEY = input.apiKey
  return env
}
