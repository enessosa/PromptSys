// Read-only git helpers for the status line and the "Changes" panel. `execFile` without a shell, `cwd` = the project folder.
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_DIFF_BYTES = 200 * 1024
const MAX_FILES = 300
const MAX_BUFFER = 64 * 1024 * 1024

export type GitInfo = { isGitRepo: boolean; branch?: string; dirty?: boolean }
export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
export type FileChange = { path: string; oldPath?: string; status: ChangeStatus; added: number; removed: number; diff: string; truncated: boolean }
export type Changes = { isGitRepo: boolean; files: FileChange[] }

type Out = { code: number; stdout: string }

/** Runs git; never throws (a failure gives a non-zero code). `git diff --no-index` exits with 1 when files differ, which is fine. */
function git(cwd: string, args: string[]): Promise<Out> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 128) : 0
      resolve({ code, stdout: String(stdout ?? '') })
    })
  })
}

async function isRepo(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  return r.code === 0 && r.stdout.trim() === 'true'
}

export async function gitInfo(cwd: string): Promise<GitInfo> {
  if (!(await isRepo(cwd))) return { isGitRepo: false }
  let branch = (await git(cwd, ['branch', '--show-current'])).stdout.trim()
  if (!branch) branch = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
  const status = await git(cwd, ['status', '--porcelain'])
  return { isGitRepo: true, ...(branch ? { branch } : {}), dirty: status.stdout.trim() !== '' }
}

type Entry = { path: string; oldPath?: string; status: ChangeStatus }

function parseStatus(raw: string): Entry[] {
  const parts = raw.split('\0')
  const entries: Entry[] = []
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i]
    if (item.length < 4) continue
    const xy = item.slice(0, 2)
    const path = item.slice(3)
    if (xy === '??') entries.push({ path, status: 'untracked' })
    else if (xy.includes('R') || xy.includes('C')) entries.push({ path, oldPath: parts[++i], status: 'renamed' })
    else if (xy.includes('D')) entries.push({ path, status: 'deleted' })
    else if (xy.includes('A')) entries.push({ path, status: 'added' })
    else entries.push({ path, status: 'modified' })
  }
  return entries
}

/** `git diff --numstat -z`: "added\tremoved\tpath\0" or, for renames, "added\tremoved\t\0old\0new\0". Keyed by the new path. */
function parseNumstat(raw: string): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>()
  const parts = raw.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(parts[i])
    if (!m) continue
    let path = m[3]
    if (path === '') {
      i += 2
      path = parts[i]
    }
    map.set(path, { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) })
  }
  return map
}

function cap(diff: string): { diff: string; truncated: boolean } {
  if (Buffer.byteLength(diff) <= MAX_DIFF_BYTES) return { diff, truncated: false }
  return { diff: Buffer.from(diff).subarray(0, MAX_DIFF_BYTES).toString('utf8'), truncated: true }
}

const countLines = (diff: string, sign: '+' | '-') =>
  diff.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(`${sign}${sign}${sign}`)).length

/** All uncommitted changes against HEAD (staged, unstaged and untracked files), with a unified diff per file. */
export async function gitChanges(cwd: string): Promise<Changes> {
  if (!(await isRepo(cwd))) return { isGitRepo: false, files: [] }
  const hasHead = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).code === 0
  const base = hasHead ? ['diff', 'HEAD'] : ['diff', '--cached']
  const [status, numstat] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '-uall']),
    git(cwd, [...base, '--numstat', '-z', '-M']),
  ])
  const counts = parseNumstat(numstat.stdout)
  const files: FileChange[] = []
  for (const entry of parseStatus(status.stdout).slice(0, MAX_FILES)) {
    if (entry.status === 'untracked') {
      let size: number
      try {
        size = statSync(join(cwd, entry.path)).size
      } catch {
        continue
      }
      const patch = size > MAX_DIFF_BYTES * 4 ? '' : (await git(cwd, ['diff', '--no-index', '--no-color', '--', '/dev/null', entry.path])).stdout
      const { diff, truncated } = cap(patch)
      files.push({ path: entry.path, status: 'untracked', added: countLines(patch, '+'), removed: 0, diff, truncated: truncated || size > MAX_DIFF_BYTES * 4 })
      continue
    }
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path]
    const patch = (await git(cwd, [...base, '--no-color', '--no-ext-diff', '-M', '--', ...paths])).stdout
    const { diff, truncated } = cap(patch)
    const n = counts.get(entry.path) ?? { added: countLines(patch, '+'), removed: countLines(patch, '-') }
    files.push({ path: entry.path, ...(entry.oldPath ? { oldPath: entry.oldPath } : {}), status: entry.status, added: n.added, removed: n.removed, diff, truncated })
  }
  return { isGitRepo: true, files }
}
