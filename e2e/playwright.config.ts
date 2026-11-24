import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// The backend (fake LLM, fake embedder, empty database) serves the built frontend on its own port, so the tests need
// neither Vite nor the developer's backend on port 8000. Build the frontend first: `npm run build` in `frontend/`.
const port = Number(process.env.E2E_PORT ?? 8765)
const dataDir = resolve(process.env.E2E_DATA_DIR ?? '.tmp')
const frontendDist = resolve(process.env.E2E_FRONTEND_DIST ?? '../frontend/dist')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // A fresh database per run: delete the old one, then start the backend (Node runs the .ts files directly).
    command: 'rm -rf "$E2E_DATA_DIR" && mkdir -p "$E2E_DATA_DIR" && exec node src/main.ts',
    cwd: '../backend',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(port),
      DB_URL: resolve(dataDir, 'promptsys.db'),
      E2E_DATA_DIR: dataDir,
      FRONTEND_DIST: frontendDist,
      PROMPTSYS_FAKE_LLM: '1',
      PROMPTSYS_FAKE_AGENT: '1',
      NODE_ENV: 'test',
      ANTHROPIC_API_KEY: '',
      EMBEDDING_CACHE_DIR: resolve(dataDir, 'models'),
    },
  },
})
