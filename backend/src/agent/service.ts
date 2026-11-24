// Session manager: runs agent turns, stores every event in `code_events` and passes it on to SSE subscribers.
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createCardRepository } from '../card/repository.ts'
import type { Card, LinkKind } from '../card/schema.ts'
import { AppError } from '../common/errors.ts'
import { createSettingsRepository } from '../settings/index.ts'
import { gitChanges, gitInfo } from './git.ts'
import type { AgentEvent, AgentRunner, CardTools, PermissionMode } from './runner.ts'

type SessionStatus = Extract<AgentEvent, { type: 'status' }>['status']

export type CodeSession = {
  id: number
  title: string
  projectPath: string
  status: SessionStatus
  permissionMode: PermissionMode
  createdAt: string
  updatedAt: string
}

export type StoredEvent = { seq: number; type: string; payload: Record<string, unknown>; createdAt: string }

export type CardReview = { id: number; title: string; body: string; reviewStatus: string; version: number }

type ActiveTurn = {
  controller: AbortController
  pending: Map<string, { resolve: (answer: { allow: boolean; message?: string }) => void }>
  done: Promise<void>
  modeListeners: Set<(mode: PermissionMode) => void>
}

type Row = Record<string, unknown>

const toSession = (row: Row): CodeSession => ({
  id: row.id as number,
  title: row.title as string,
  projectPath: row.project_path as string,
  status: row.status as SessionStatus,
  permissionMode: row.permission_mode as PermissionMode,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
})

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

/** Sessions that were running when the process stopped can never continue: mark them `stopped`. Returns how many. */
export function resetStaleSessions(db: DatabaseSync): number {
  const result = db.prepare(`UPDATE code_sessions SET status = 'stopped', updated_at = ${NOW} WHERE status IN ('running','waiting_approval')`).run()
  return Number(result.changes)
}

/** Text that goes in front of the user's prompt: the confirmed and corrected agent cards of this project. */
/** Cards of a project live under a folder named after the project folder ("PromptSys"). */
export function cardRoot(projectPath: string): string {
  return basename(projectPath).replace(/[^\w .-]/g, '-') || 'project'
}

/** The agent's folder below the project root; "..", empty parts and odd characters are dropped. */
export function cardFolder(projectPath: string, folder: string | undefined): string {
  const parts = (folder ?? '')
    .split('/')
    .map((p) => p.trim().replace(/[^\w .-]/g, '-'))
    .filter((p) => p && p !== '.' && p !== '..')
  return [cardRoot(projectPath), ...parts].join('/').slice(0, 500)
}

/** Cards the user referenced in the message as [cN] (archived and unknown ones are left out). */
export function referencedBlock(db: DatabaseSync, text: string): string {
  const ids = [...new Set([...text.matchAll(/\[c(\d+)\]/g)].map((m) => Number(m[1])))].slice(0, 20)
  if (ids.length === 0) return ''
  const rows = db
    .prepare(`SELECT id, title, body, folder_path FROM cards WHERE archived_at IS NULL AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids)
  if (rows.length === 0) return ''
  const limit = 8000
  const body = (b: string) => (b.length > limit ? `${b.slice(0, limit)}…` : b)
  return rows.map((r) => `[c${r.id}] ${r.title as string} (folder: ${(r.folder_path as string) || '/'}):\n${body(r.body as string)}`).join('\n\n')
}

export function bindingBlock(db: DatabaseSync, projectPath: string, text = ''): string {
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.body FROM cards c JOIN code_sessions s ON s.id = c.code_session_id
       WHERE c.origin = 'agent' AND c.review_status IN ('confirmed','corrected') AND c.archived_at IS NULL AND s.project_path = ?
       ORDER BY c.id`,
    )
    .all(projectPath)
  const rejected = db
    .prepare(
      `SELECT DISTINCT c.title FROM cards c JOIN code_sessions s ON s.id = c.code_session_id
       WHERE c.origin = 'agent' AND c.review_status = 'rejected' AND s.project_path = ? ORDER BY c.title`,
    )
    .all(projectPath)
    .map((r) => r.title as string)
  const referenced = referencedBlock(db, text)
  if (rows.length === 0 && rejected.length === 0 && !referenced) return ''
  const lines = rows.map((r) => `[c${r.id}] ${r.title}: ${r.body}`)
  if (rejected.length > 0) lines.push(`Rejected by the user, do not record again: ${rejected.join('; ')}`)
  if (referenced) lines.push(`Referenced by the user in this message:\n${referenced}`)
  return `<promptsys-cards>\n${lines.join('\n')}\n</promptsys-cards>`
}

export function createAgentService(db: DatabaseSync, runner: AgentRunner) {
  const cards = createCardRepository(db)
  const settings = createSettingsRepository(db)
  const active = new Map<number, ActiveTurn>()
  const subscribers = new Map<number, Set<(event: StoredEvent) => void>>()

  const notFound = (id: number) => new AppError(404, 'session_not_found', `Session ${id} not found`)
  const row = (id: number): Row => {
    const found = db.prepare('SELECT * FROM code_sessions WHERE id = ?').get(id)
    if (!found) throw notFound(id)
    return found
  }

  function emit(sessionId: number, event: AgentEvent): void {
    const { type, ...payload } = event
    const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM code_events WHERE session_id = ?').get(sessionId)?.next as number) ?? 1
    const createdAt = new Date().toISOString()
    db.prepare('INSERT INTO code_events (session_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(sessionId, seq, type, JSON.stringify(payload), createdAt)
    if (type === 'status') {
      db.prepare(`UPDATE code_sessions SET status = ?, updated_at = ${NOW} WHERE id = ?`).run((event as { status: string }).status, sessionId)
    }
    for (const listener of subscribers.get(sessionId) ?? []) listener({ seq, type, payload, createdAt })
  }

  const envFor = (): Record<string, string | undefined> => {
    const env: Record<string, string | undefined> = { ...process.env }
    // With the local login the SDK must not pick up an API key from the environment.
    if (settings.get().codeAuth === 'local_login') delete env.ANTHROPIC_API_KEY
    return env
  }

  /**
   * Before the first turn: fills `slash_commands` (so `/` suggestions work right away) and, for a new session, records the
   * messages of the user's SessionStart hooks as `notice` events. Failures leave things as they are.
   */
  async function probe(sessionId: number, projectPath: string, withNotices: boolean): Promise<void> {
    if (!runner.probe) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), 10_000)))
      const { commands, notices } = await Promise.race([runner.probe({ cwd: projectPath, env: envFor() }), timeout])
      if (commands.length > 0) db.prepare('UPDATE code_sessions SET slash_commands = ? WHERE id = ?').run(JSON.stringify(commands), sessionId)
      if (withNotices) for (const text of notices) emit(sessionId, { type: 'notice', text, source: 'SessionStart' })
    } catch {
      // No list yet: the first turn's init message fills it.
    } finally {
      clearTimeout(timer)
    }
  }

  function cardToolsFor(sessionId: number): CardTools {
    const link = (sourceId: number, targetId: number, kind: LinkKind | undefined, label: string | undefined) => {
      cards.createLink({ sourceId, targetId, kind: kind ?? 'related', label: label ?? null })
      emit(sessionId, { type: 'card', cardId: targetId, action: 'linked' })
    }
    return {
      async findCards({ query }) {
        const root = cardRoot(toSession(row(sessionId)).projectPath)
        const found = cards.list({ includeArchived: false, includeProposed: true, ...(query?.trim() ? { query: query.trim() } : { folder: root }) }).slice(0, 50)
        if (found.length === 0) return query ? `No cards match "${query}".` : `No cards in the project folder "${root}" yet.`
        return found.map((c) => `[c${c.id}] ${c.title} (folder: ${c.folderPath || '/'})${c.reviewStatus === 'proposed' ? ' – proposed, not reviewed yet' : ''}`).join('\n')
      },
      async recordCard({ title: cardTitle, body, folder, linkTo }) {
        // One card per term and project: a rejected term is refused, an existing one is reused instead of duplicated.
        const projectPath = toSession(row(sessionId)).projectPath
        const existing = db
          .prepare(
            `SELECT c.id, c.review_status FROM cards c JOIN code_sessions s ON s.id = c.code_session_id
             WHERE c.origin = 'agent' AND c.archived_at IS NULL AND s.project_path = ? AND lower(trim(c.title)) = lower(trim(?))
             ORDER BY c.id DESC LIMIT 1`,
          )
          .get(projectPath, cardTitle)
        if (existing?.review_status === 'rejected') {
          throw new AppError(409, 'card_rejected', `The user rejected the card "${cardTitle.trim()}"; do not record it again.`)
        }
        if (existing) return existing.id as number
        const card = cards.create({
          title: cardTitle.trim().slice(0, 200) || 'Untitled',
          body,
          kind: 'note',
          folderPath: cardFolder(projectPath, folder),
          defaultIncluded: false,
          agent: { sessionId, reviewStatus: 'proposed' },
        })
        emit(sessionId, { type: 'card', cardId: card.id, action: 'created' })
        for (const target of linkTo ?? []) {
          try {
            link(card.id, target.cardId, target.kind, target.label)
          } catch (err) {
            if (!(err instanceof AppError)) throw err // an unknown or archived target must not lose the card
          }
        }
        return card.id
      },
      async linkCards({ sourceId, targetId, kind, label }) {
        link(sourceId, targetId, kind, label)
      },
    }
  }

  async function runTurn(sessionId: number, turn: ActiveTurn, prompt: string): Promise<void> {
    const session = toSession(row(sessionId))
    const sdkSessionId = (row(sessionId).sdk_session_id as string | null) ?? undefined
    const setStatus = (status: SessionStatus) => emit(sessionId, { type: 'status', status })
    let failed = false
    try {
      const events = runner.runTurn({
        cwd: session.projectPath,
        prompt,
        ...(sdkSessionId ? { resume: sdkSessionId } : {}),
        env: envFor(),
        cardTools: cardToolsFor(sessionId),
        signal: turn.controller.signal,
        getPermissionMode: () => row(sessionId).permission_mode as PermissionMode,
        onPermissionMode: (listener) => {
          turn.modeListeners.add(listener)
          return () => void turn.modeListeners.delete(listener)
        },
        approve: (req) =>
          new Promise((resolve) => {
            if (turn.controller.signal.aborted) return resolve({ allow: false, message: 'Stopped' })
            const approvalId = crypto.randomUUID()
            turn.pending.set(approvalId, {
              resolve: (answer) => {
                turn.pending.delete(approvalId)
                emit(sessionId, { type: 'approval_resolved', approvalId, allow: answer.allow })
                if (turn.pending.size === 0 && !turn.controller.signal.aborted) setStatus('running')
                resolve(answer)
              },
            })
            emit(sessionId, { type: 'approval_request', approvalId, toolName: req.toolName, input: req.input })
            setStatus('waiting_approval')
          }),
      })
      for await (const event of events) {
        if (event.type === 'init') {
          db.prepare('UPDATE code_sessions SET sdk_session_id = ?, slash_commands = ? WHERE id = ?').run(event.sdkSessionId, JSON.stringify(event.slashCommands), sessionId)
        }
        // Status and approvals belong to the service; a runner only reports what the agent did.
        if (event.type === 'status' || event.type === 'approval_request' || event.type === 'approval_resolved' || event.type === 'mode') continue
        emit(sessionId, event)
      }
    } catch (err) {
      if (!turn.controller.signal.aborted) {
        failed = true
        emit(sessionId, { type: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    for (const pending of [...turn.pending.values()]) pending.resolve({ allow: false, message: 'Stopped' })
    // Free the session before announcing the end, so a client that reacts to `idle` can send the next message at once.
    if (active.get(sessionId) === turn) active.delete(sessionId)
    setStatus(turn.controller.signal.aborted ? 'stopped' : failed ? 'error' : 'idle')
  }

  return {
    status: () => runner.available(),

    /** Plan limits are account-wide: the newest report of any session, with the time it was observed (null before the first one). */
    planUsage(): (Record<string, unknown> & { observedAt: string }) | null {
      const latest = db.prepare("SELECT payload, created_at FROM code_events WHERE type = 'plan_usage' ORDER BY created_at DESC, id DESC LIMIT 1").get()
      return latest ? { ...(JSON.parse(latest.payload as string) as Record<string, unknown>), observedAt: latest.created_at as string } : null
    },

    list(): CodeSession[] {
      return db.prepare('SELECT * FROM code_sessions ORDER BY id').all().map(toSession)
    },

    async create(input: { projectPath: string; title?: string }): Promise<CodeSession> {
      const path = input.projectPath
      if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory()) {
        throw new AppError(422, 'invalid_project_path', 'The project path must be an absolute path to an existing folder.', [{ path: 'projectPath', message: 'not an existing absolute folder' }])
      }
      const title = input.title?.trim() || basename(path) || path
      const result = db.prepare('INSERT INTO code_sessions (title, project_path) VALUES (?, ?)').run(title, path)
      const id = Number(result.lastInsertRowid)
      await probe(id, path, true)
      return toSession(row(id))
    },

    async get(id: number) {
      let found = row(id)
      if ((JSON.parse(found.slash_commands as string) as string[]).length === 0) {
        await probe(id, found.project_path as string, false)
        found = row(id)
      }
      const events: StoredEvent[] = db
        .prepare('SELECT seq, type, payload, created_at FROM code_events WHERE session_id = ? ORDER BY seq')
        .all(id)
        .map((e) => ({ seq: e.seq as number, type: e.type as string, payload: JSON.parse(e.payload as string) as Record<string, unknown>, createdAt: e.created_at as string }))
      return { session: toSession(found), slashCommands: JSON.parse(found.slash_commands as string) as string[], events }
    },

    rename(id: number, title: string): CodeSession {
      row(id)
      db.prepare(`UPDATE code_sessions SET title = ?, updated_at = ${NOW} WHERE id = ?`).run(title, id)
      return toSession(row(id))
    },

    /** Changes how much the agent may do without asking; takes effect at once, also in a running turn. */
    setPermissionMode(id: number, mode: PermissionMode): CodeSession {
      row(id)
      db.prepare(`UPDATE code_sessions SET permission_mode = ?, updated_at = ${NOW} WHERE id = ?`).run(mode, id)
      emit(id, { type: 'mode', mode })
      for (const listener of active.get(id)?.modeListeners ?? []) listener(mode)
      return toSession(row(id))
    },

    git: (id: number) => gitInfo(toSession(row(id)).projectPath),
    changes: (id: number) => gitChanges(toSession(row(id)).projectPath),

    async remove(id: number): Promise<void> {
      row(id)
      await this.stop(id)
      db.prepare('DELETE FROM code_sessions WHERE id = ?').run(id)
      subscribers.delete(id)
    },

    /** Starts a turn in the background (events arrive through `subscribe` and `get`). */
    sendMessage(id: number, text: string): void {
      const session = toSession(row(id))
      if (active.has(id)) throw new AppError(409, 'session_busy', 'This session is still working on the last message.')
      // A slash command has to stay the first thing in the prompt, so it gets no card block.
      const block = text.startsWith('/') ? '' : bindingBlock(db, session.projectPath, text)
      const prompt = block ? `${block}\n\n${text}` : text
      const turn: ActiveTurn = { controller: new AbortController(), pending: new Map(), done: Promise.resolve(), modeListeners: new Set() }
      active.set(id, turn)
      emit(id, { type: 'user', text })
      emit(id, { type: 'status', status: 'running' })
      turn.done = runTurn(id, turn, prompt)
        .catch((err: unknown) => console.error('Agent turn failed', err))
        .finally(() => {
          if (active.get(id) === turn) active.delete(id)
        })
    },

    /** Aborts a running turn and denies its open approvals. Resolves when the turn has ended. */
    async stop(id: number): Promise<void> {
      row(id)
      const turn = active.get(id)
      if (!turn) return
      turn.controller.abort()
      for (const pending of [...turn.pending.values()]) pending.resolve({ allow: false, message: 'Stopped' })
      await turn.done
    },

    resolveApproval(id: number, approvalId: string, answer: { allow: boolean; message?: string }): void {
      row(id)
      const pending = active.get(id)?.pending.get(approvalId)
      if (!pending) throw new AppError(404, 'approval_not_found', `Approval ${approvalId} not found`)
      pending.resolve(answer)
    },

    subscribe(id: number, listener: (event: StoredEvent) => void): () => void {
      row(id)
      const set = subscribers.get(id) ?? new Set()
      set.add(listener)
      subscribers.set(id, set)
      return () => set.delete(listener)
    },

    /** Cards of the session still waiting for review; confirmed, corrected and rejected ones leave the list. */
    sessionCards(id: number): CardReview[] {
      row(id)
      return db
        .prepare("SELECT id, title, body, review_status, version FROM cards WHERE code_session_id = ? AND origin = 'agent' AND review_status = 'proposed' AND archived_at IS NULL ORDER BY id")
        .all(id)
        .map((c) => ({ id: c.id as number, title: c.title as string, body: c.body as string, reviewStatus: c.review_status as string, version: c.version as number }))
    },

    /** Review of an agent card: confirm or reject it, or change its text (which makes it `corrected`). */
    reviewCard(cardId: number, changes: { reviewStatus?: 'confirmed' | 'rejected'; title?: string; body?: string }): Card {
      const current = cards.get(cardId)
      if (current.origin !== 'agent') throw new AppError(404, 'card_not_found', `Card c${cardId} is not an agent card`)
      const textChanged = (changes.title !== undefined && changes.title !== current.title) || (changes.body !== undefined && changes.body !== current.body)
      if (textChanged) cards.update(cardId, { title: changes.title, body: changes.body })
      const status = changes.reviewStatus === 'rejected' ? 'rejected' : textChanged ? 'corrected' : changes.reviewStatus
      if (status) db.prepare('UPDATE cards SET review_status = ? WHERE id = ?').run(status, cardId)
      return cards.get(cardId)
    },
  }
}

export type AgentService = ReturnType<typeof createAgentService>
