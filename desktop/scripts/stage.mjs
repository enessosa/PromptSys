// Collects what the packaged app needs next to the Electron code, in desktop/stage/:
//   stage/backend   compiled backend (dist), migrations, production node_modules (installed fresh)
//   stage/frontend  built frontend
// Run on the platform you build for: the native modules (onnxruntime-node, sharp) are platform specific.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const desktop = join(import.meta.dirname, '..')
const repo = join(desktop, '..')
const stage = join(desktop, 'stage')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (cwd, args) => execFileSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })

if (!process.argv.includes('--no-build')) {
  run(join(repo, 'backend'), ['run', 'build'])
  run(join(repo, 'frontend'), ['run', 'build'])
}
for (const dir of [join(repo, 'backend', 'dist'), join(repo, 'frontend', 'dist')]) {
  if (!existsSync(dir)) throw new Error(`${dir} is missing: build backend and frontend first`)
}

rmSync(stage, { recursive: true, force: true })
const backend = join(stage, 'backend')
mkdirSync(backend, { recursive: true })
cpSync(join(repo, 'backend', 'dist'), join(backend, 'dist'), { recursive: true })
cpSync(join(repo, 'backend', 'migrations'), join(backend, 'migrations'), { recursive: true })
for (const file of ['package.json', 'package-lock.json']) cpSync(join(repo, 'backend', file), join(backend, file))
cpSync(join(repo, 'frontend', 'dist'), join(stage, 'frontend'), { recursive: true })

// Production dependencies only (no Anthropic key, no dev tools).
run(backend, ['ci', '--omit=dev', '--no-audit', '--no-fund'])

// onnxruntime-node ships binaries for every OS/arch (several hundred MB); keep only the one we run on.
const bin = join(backend, 'node_modules', 'onnxruntime-node', 'bin')
const platform = process.env.TARGET_PLATFORM ?? process.platform
const arch = process.env.TARGET_ARCH ?? process.arch
if (existsSync(bin)) {
  for (const napi of readdirSync(bin)) {
    for (const p of readdirSync(join(bin, napi))) {
      if (p !== platform) rmSync(join(bin, napi, p), { recursive: true, force: true })
      else for (const a of readdirSync(join(bin, napi, p))) if (a !== arch) rmSync(join(bin, napi, p, a), { recursive: true, force: true })
    }
  }
}
console.log(`staged for ${platform}-${arch}`)
