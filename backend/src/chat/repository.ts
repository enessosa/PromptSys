import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { PromptCard } from '../assembly/index.ts'
import type { CardLookup, ResolvedCitation } from '../citation/index.ts'
import { AppError } from '../common/errors.ts'
import type { LlmMessage } from '../llm/index.ts'
import type {
  CardState,
  CitationDto,
  ContextCard,
  ContextEntry,
  Conversation,
  Message,
  ReplayStatus,
  Timeline,
} from './schema.ts'

type Row = Record<string, unknown>

const EXCERPT_LENGTH = 200
const DEFAULT_TITLE = 'New conversation'
const MAX_MERGE_HOPS = 20

const conversationNotFound = (id: number) => new AppError(404, 'conversation_not_found', `Conversation ${id} not found`)
const timelineNotFound = (id: number) => new AppError(404, 'timeline_not_found', `Timeline ${id} not found`)
const messageNotFound = (id: number) => new AppError(404, 'message_not_found', `Message ${id} not found`)

function toConversation(row: Row): Conversation {
  return {
    id: row.id as number,
    title: row.title as string,
    systemPrompt: row.system_prompt as string,
    model: row.model as string | null,
    activeTimelineId: row.active_timeline_id as number | null,
    showDerivedRules: row.show_derived_rules === 1,
    archivedAt: row.archived_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function toTimeline(row: Row): Timeline {
  return {
    id: row.id as number,
    conversationId: row.conversation_id as number,
    name: row.name as string,
    parentTimelineId: row.parent_timeline_id as number | null,
    branchPointId: row.branch_point_id as number | null,
    headMessageId: row.head_message_id as number | null,
    changeSummary: row.change_summary as string | null,
    replayStatus: row.replay_status as Timeline['replayStatus'],
    replayMode: row.replay_mode as Timeline['replayMode'],
    replaySourceId: row.replay_source_id as number | null,
    replayNextId: row.replay_next_id as number | null,
    createdAt: row.created_at as string,
  }
}

/** A message row as stored; `Message` (the API shape) is built from it by `messagesOfTimeline`. */
export type MessageRow = {
  id: number
  conversationId: number
  parentId: number | null
  role: 'user' | 'assistant'
  content: string
  status: Message['status']
  replayOfId: number | null
  model: string | null
  stopReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  errorCode: string | null
  createdAt: string
}

function toMessageRow(row: Row): MessageRow {
  return {
    id: row.id as number,
    conversationId: row.conversation_id as number,
    parentId: row.parent_id as number | null,
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
    status: row.status as Message['status'],
    replayOfId: row.replay_of_id as number | null,
    model: row.model as string | null,
    stopReason: row.stop_reason as string | null,
    inputTokens: row.input_tokens as number | null,
    outputTokens: row.output_tokens as number | null,
    errorCode: row.error_code as string | null,
    createdAt: row.created_at as string,
  }
}

const PATH_SQL = `
  WITH RECURSIVE path(id, parent_id, depth) AS (
    SELECT id, parent_id, 0 FROM messages WHERE id = ?
    UNION ALL
    SELECT m.id, m.parent_id, p.depth + 1 FROM messages m JOIN path p ON m.id = p.parent_id
  )
  SELECT m.*, path.depth AS depth FROM path JOIN messages m ON m.id = path.id ORDER BY path.depth DESC`

export function createChatRepository(db: DatabaseSync) {
  const one = (sql: string, ...params: SQLInputValue[]): Row | undefined => db.prepare(sql).get(...params)
  const all = (sql: string, ...params: SQLInputValue[]): Row[] => db.prepare(sql).all(...params)
  const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params)

  // ---- conversations -------------------------------------------------------------------------------------------

  function getConversation(id: number): Conversation {
    const row = one('SELECT * FROM conversations WHERE id = ?', id)
    if (!row) throw conversationNotFound(id)
    return toConversation(row)
  }

  function listConversations(): Conversation[] {
    return all('SELECT * FROM conversations WHERE archived_at IS NULL ORDER BY updated_at DESC, id DESC').map(toConversation)
  }

  /** Creates the conversation and its first timeline `main` (the active one). Run inside a transaction. */
  function createConversation(input: { title?: string; systemPrompt: string; model?: string | null }): Conversation {
    const { lastInsertRowid } = run(
      'INSERT INTO conversations (title, system_prompt, model) VALUES (?, ?, ?)',
      input.title ?? DEFAULT_TITLE,
      input.systemPrompt,
      input.model ?? null,
    )
    const id = Number(lastInsertRowid)
    const timeline = run("INSERT INTO timelines (conversation_id, name) VALUES (?, 'main')", id)
    run('UPDATE conversations SET active_timeline_id = ? WHERE id = ?', Number(timeline.lastInsertRowid), id)
    return getConversation(id)
  }

  type ConversationChanges = {
    title?: string
    systemPrompt?: string
    model?: string | null
    showDerivedRules?: boolean
    activeTimelineId?: number
  }

  function updateConversation(id: number, changes: ConversationChanges): Conversation {
    getConversation(id)
    if (changes.activeTimelineId !== undefined && getTimeline(changes.activeTimelineId).conversationId !== id) {
      throw timelineNotFound(changes.activeTimelineId)
    }
    const columns: Record<string, SQLInputValue | undefined> = {
      title: changes.title,
      system_prompt: changes.systemPrompt,
      model: changes.model,
      show_derived_rules: changes.showDerivedRules === undefined ? undefined : changes.showDerivedRules ? 1 : 0,
      active_timeline_id: changes.activeTimelineId,
    }
    const set = Object.entries(columns).filter(([, v]) => v !== undefined)
    run(
      `UPDATE conversations SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      ...set.map(([, v]) => v as SQLInputValue),
      id,
    )
    return getConversation(id)
  }

  function deleteConversation(id: number) {
    getConversation(id)
    // Messages and timelines point at each other (head / branch point), so cut the timeline links first.
    run('UPDATE timelines SET head_message_id = NULL, branch_point_id = NULL WHERE conversation_id = ?', id)
    run('DELETE FROM conversations WHERE id = ?', id)
  }

  function touchConversation(id: number, titleFromMessage?: string) {
    run("UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", id)
    if (titleFromMessage !== undefined) {
      const title = titleFromMessage.replace(/\s+/g, ' ').trim().slice(0, 60)
      if (title) run('UPDATE conversations SET title = ? WHERE id = ? AND title = ?', title, id, DEFAULT_TITLE)
    }
  }

  // ---- timelines -----------------------------------------------------------------------------------------------

  function getTimeline(id: number): Timeline {
    const row = one('SELECT * FROM timelines WHERE id = ?', id)
    if (!row) throw timelineNotFound(id)
    return toTimeline(row)
  }

  const timelinesOf = (conversationId: number): Timeline[] =>
    all('SELECT * FROM timelines WHERE conversation_id = ? ORDER BY id', conversationId).map(toTimeline)

  function createTimeline(input: {
    conversationId: number
    name: string
    parentTimelineId: number | null
    branchPointId: number | null
    headMessageId: number | null
    changeSummary: string | null
    replay?: { status: 'paused'; mode: 'step' | 'auto'; sourceId: number; nextId: number | null }
  }): Timeline {
    const { lastInsertRowid } = run(
      'INSERT INTO timelines (conversation_id, name, parent_timeline_id, branch_point_id, head_message_id, change_summary, replay_status, replay_mode, replay_source_id, replay_next_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      input.conversationId,
      input.name,
      input.parentTimelineId,
      input.branchPointId,
      input.headMessageId,
      input.changeSummary,
      input.replay?.status ?? null,
      input.replay?.mode ?? null,
      input.replay?.sourceId ?? null,
      input.replay?.nextId ?? null,
    )
    return getTimeline(Number(lastInsertRowid))
  }

  const setHead = (timelineId: number, messageId: number) =>
    run('UPDATE timelines SET head_message_id = ? WHERE id = ?', messageId, timelineId)

  function updateReplay(timelineId: number, changes: { status?: ReplayStatus; mode?: 'step' | 'auto'; nextId?: number | null }) {
    const columns: Record<string, SQLInputValue | undefined> = {
      replay_status: changes.status,
      replay_mode: changes.mode,
      replay_next_id: changes.nextId,
    }
    const set = Object.entries(columns).filter(([, v]) => v !== undefined)
    if (set.length === 0) return
    run(`UPDATE timelines SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...set.map(([, v]) => v as SQLInputValue), timelineId)
  }

  /** The first timeline (lowest id) whose path contains the message; used as parent of a new branch. */
  function timelineContaining(conversationId: number, messageId: number): Timeline | undefined {
    return timelinesOf(conversationId).find((t) => t.headMessageId !== null && pathTo(t.headMessageId).some((m) => m.id === messageId))
  }

  // ---- messages ------------------------------------------------------------------------------------------------

  function getMessage(id: number): MessageRow {
    const row = one('SELECT * FROM messages WHERE id = ?', id)
    if (!row) throw messageNotFound(id)
    return toMessageRow(row)
  }

  /** Messages from the root down to `headId` (inclusive). */
  const pathTo = (headId: number | null): MessageRow[] => (headId === null ? [] : all(PATH_SQL, headId).map(toMessageRow))

  /** The answer to `userMessageId` on the given timeline (`null` if it has none). */
  function childAnswerOf(userMessageId: number, timelineId: number): number | null {
    const path = pathTo(getTimeline(timelineId).headMessageId)
    return path.find((m) => m.role === 'assistant' && m.parentId === userMessageId)?.id ?? null
  }

  /** Previous turns as plain chat messages; empty answers (failed before the first token) are left out. */
  function historyOf(headId: number | null): LlmMessage[] {
    return pathTo(headId)
      .filter((m) => m.content !== '' && m.status !== 'streaming')
      .map((m) => ({ role: m.role, content: m.content }))
  }

  function insertMessage(input: {
    conversationId: number
    parentId: number | null
    role: 'user' | 'assistant'
    content?: string
    status?: Message['status']
    replayOfId?: number | null
    model?: string | null
  }): number {
    const { lastInsertRowid } = run(
      'INSERT INTO messages (conversation_id, parent_id, role, content, status, replay_of_id, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.conversationId,
      input.parentId,
      input.role,
      input.content ?? '',
      input.status ?? 'complete',
      input.replayOfId ?? null,
      input.model ?? null,
    )
    return Number(lastInsertRowid)
  }

  const saveProgress = (id: number, content: string) => run('UPDATE messages SET content = ? WHERE id = ?', content, id)

  function finishMessage(
    id: number,
    result: {
      content: string
      status: 'complete' | 'stopped' | 'error'
      stopReason: string | null
      inputTokens: number | null
      outputTokens: number | null
      errorCode: string | null
    },
  ) {
    run(
      'UPDATE messages SET content = ?, status = ?, stop_reason = ?, input_tokens = ?, output_tokens = ?, error_code = ? WHERE id = ?',
      result.content,
      result.status,
      result.stopReason,
      result.inputTokens,
      result.outputTokens,
      result.errorCode,
      id,
    )
  }

  /** Messages left in `streaming` by a crashed or killed process can never finish; mark them as failed. */
  function markInterrupted(): number {
    return Number(run("UPDATE messages SET status = 'error', error_code = 'interrupted' WHERE status = 'streaming'").changes)
  }

  function insertCitations(messageId: number, citations: ResolvedCitation[]) {
    const insert = db.prepare(
      'INSERT INTO citations (message_id, card_id, raw_marker, start_offset, end_offset, valid) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const c of citations) insert.run(messageId, c.cardId, c.marker, c.start, c.end, c.valid ? 1 : 0)
  }

  // ---- context state -------------------------------------------------------------------------------------------

  const contextOf = (messageId: number): ContextEntry[] =>
    all('SELECT card_id, card_version, state, position FROM message_cards WHERE message_id = ? ORDER BY position, card_id', messageId).map(
      (r) => ({ cardId: r.card_id as number, version: r.card_version as number, state: r.state as CardState, position: r.position as number }),
    )

  function insertContext(messageId: number, entries: ContextEntry[]) {
    const insert = db.prepare('INSERT INTO message_cards (message_id, card_id, card_version, state, position) VALUES (?, ?, ?, ?, ?)')
    for (const e of entries) insert.run(messageId, e.cardId, e.version, e.state, e.position)
  }

  /** The context a branch starts with (set by "branch from here" with changes); `undefined` once the timeline has own messages. */
  function pendingContext(timelineId: number): ContextEntry[] | undefined {
    const rows = all('SELECT card_id, card_version, state, position FROM timeline_context WHERE timeline_id = ? ORDER BY position, card_id', timelineId)
    if (rows.length === 0) return undefined
    return rows.map((r) => ({ cardId: r.card_id as number, version: r.card_version as number, state: r.state as CardState, position: r.position as number }))
  }

  function setPendingContext(timelineId: number, entries: ContextEntry[]) {
    const insert = db.prepare('INSERT INTO timeline_context (timeline_id, card_id, card_version, state, position) VALUES (?, ?, ?, ?, ?)')
    for (const e of entries) insert.run(timelineId, e.cardId, e.version, e.state, e.position)
  }

  const clearPendingContext = (timelineId: number) => run('DELETE FROM timeline_context WHERE timeline_id = ?', timelineId)

  /** Follows `merged_into_id` to the card that is still alive; `null` if it ends at an archived card or loops. */
  function liveCard(cardId: number): Row | null {
    let id = cardId
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const row = one('SELECT id, version, archived_at, merged_into_id FROM cards WHERE id = ?', id)
      if (!row) return null
      if (row.merged_into_id === null) return row.archived_at === null ? row : null
      id = row.merged_into_id as number
    }
    return null
  }

  const STRENGTH: Record<CardState, number> = { pinned: 2, included: 1, excluded: 0 }

  /**
   * The context a new message on this timeline starts with: the context of the nearest user message above the head,
   * brought up to date (current card versions, merged cards replaced by their target, archived cards dropped).
   * For the first message of a conversation: the cards with `default_included = 1`.
   */
  function defaultContext(headId: number | null): ContextEntry[] {
    const lastUser = pathTo(headId).findLast((m) => m.role === 'user')
    if (!lastUser) {
      return all('SELECT id, version FROM cards WHERE default_included = 1 AND archived_at IS NULL AND merged_into_id IS NULL ORDER BY id').map(
        (r, i) => ({ cardId: r.id as number, version: r.version as number, state: 'included' as const, position: i }),
      )
    }
    const byCard = new Map<number, ContextEntry>()
    for (const e of contextOf(lastUser.id)) {
      const live = liveCard(e.cardId)
      if (!live) continue
      const cardId = live.id as number
      const existing = byCard.get(cardId)
      if (existing && STRENGTH[existing.state] >= STRENGTH[e.state]) continue
      byCard.set(cardId, { cardId, version: live.version as number, state: e.state, position: existing?.position ?? e.position })
    }
    return [...byCard.values()].sort((a, b) => a.position - b.position || a.cardId - b.cardId)
  }

  /** An explicit card list from the client (complete context state; the list order is the prompt order). */
  function explicitContext(cards: { cardId: number; state: CardState }[]): ContextEntry[] {
    const seen = new Set<number>()
    return cards.map(({ cardId, state }, position) => {
      if (seen.has(cardId)) {
        throw new AppError(400, 'validation_failed', `Card c${cardId} is listed twice`, [{ path: 'cards', message: `duplicate card c${cardId}` }])
      }
      seen.add(cardId)
      const row = one('SELECT id, version, archived_at, merged_into_id FROM cards WHERE id = ?', cardId)
      if (!row) throw new AppError(404, 'card_not_found', `Card c${cardId} not found`)
      if (row.merged_into_id !== null) throw new AppError(409, 'card_merged', `Card c${cardId} was merged into c${row.merged_into_id as number}`)
      if (row.archived_at !== null) throw new AppError(409, 'card_archived', `Card c${cardId} is archived`)
      return { cardId, version: row.version as number, state, position }
    })
  }

  /** The cards of a context as they go into the prompt: the exact stored version text, only `included` and `pinned`. */
  function promptCards(entries: ContextEntry[]): PromptCard[] {
    return entries
      .filter((e) => e.state !== 'excluded')
      .map((e) => {
        const row = one(
          'SELECT c.kind AS kind, v.title AS title, v.body AS body FROM cards c JOIN card_versions v ON v.card_id = c.id AND v.version = ? WHERE c.id = ?',
          e.version,
          e.cardId,
        )
        if (!row) throw new AppError(404, 'card_not_found', `Card c${e.cardId} not found`)
        return { id: e.cardId, kind: row.kind as string, title: row.title as string, body: row.body as string, state: e.state as 'included' | 'pinned', position: e.position }
      })
  }

  /** Context entries with title, kind and excerpt (of the stored version) for the UI. */
  function describeContext(entries: ContextEntry[]): ContextCard[] {
    return entries.map((e) => {
      const row = one(
        'SELECT c.kind AS kind, v.title AS title, v.body AS body FROM cards c JOIN card_versions v ON v.card_id = c.id AND v.version = ? WHERE c.id = ?',
        e.version,
        e.cardId,
      )
      return { ...e, title: (row?.title as string) ?? `c${e.cardId}`, kind: (row?.kind as string) ?? 'note', excerpt: ((row?.body as string) ?? '').slice(0, EXCERPT_LENGTH) }
    })
  }

  const citationLookup = (promptCardIds: readonly number[]): CardLookup => ({
    inPrompt: new Set(promptCardIds),
    mergedInto(cardId) {
      const row = one('SELECT merged_into_id FROM cards WHERE id = ?', cardId)
      return row ? (row.merged_into_id as number | null) : undefined
    },
  })

  // ---- reading -------------------------------------------------------------------------------------------------

  function messagesOfTimeline(timeline: Timeline): Message[] {
    return pathTo(timeline.headMessageId).map((m) => {
      const citations: CitationDto[] = all(
        'SELECT card_id, raw_marker, start_offset, end_offset, valid FROM citations WHERE message_id = ? ORDER BY start_offset, id',
        m.id,
      ).map((r) => ({
        cardId: r.card_id as number | null,
        marker: r.raw_marker as string,
        start: r.start_offset as number,
        end: r.end_offset as number,
        valid: r.valid === 1,
      }))
      const parentContext = m.role === 'assistant' && m.parentId !== null ? contextOf(m.parentId) : []
      const used = [...new Set(citations.filter((c) => c.valid).map((c) => c.cardId as number))]
      return {
        id: m.id,
        parentId: m.parentId,
        role: m.role,
        content: m.content,
        status: m.status,
        replayOfId: m.replayOfId,
        model: m.model,
        stopReason: m.stopReason,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        errorCode: m.errorCode,
        createdAt: m.createdAt,
        context: m.role === 'user' ? describeContext(contextOf(m.id)) : null,
        citations,
        usedCardIds: used,
        unusedCardIds: parentContext.filter((e) => e.state !== 'excluded' && !used.includes(e.cardId)).map((e) => e.cardId),
        invalidMarkers: [...new Set(citations.filter((c) => !c.valid).map((c) => c.marker))],
      }
    })
  }

  /** The branch view: all timelines and every message with the timelines it belongs to. */
  function tree(conversationId: number) {
    const timelines = timelinesOf(conversationId)
    const messages = all(
      'SELECT id, parent_id, role, status, replay_of_id, substr(content, 1, ?) AS excerpt FROM messages WHERE conversation_id = ? ORDER BY id',
      EXCERPT_LENGTH,
      conversationId,
    ).map((r) => ({
      id: r.id as number,
      parentId: r.parent_id as number | null,
      role: r.role as 'user' | 'assistant',
      status: r.status as Message['status'],
      replayOfId: r.replay_of_id as number | null,
      excerpt: r.excerpt as string,
      timelineIds: [] as number[],
    }))
    const byId = new Map(messages.map((m) => [m.id, m]))
    for (const t of timelines) {
      for (let id = t.headMessageId; id !== null; id = byId.get(id)?.parentId ?? null) byId.get(id)?.timelineIds.push(t.id)
    }
    return { timelines, messages }
  }

  return {
    getConversation,
    listConversations,
    createConversation,
    updateConversation,
    deleteConversation,
    touchConversation,
    getTimeline,
    timelinesOf,
    createTimeline,
    setHead,
    updateReplay,
    pendingContext,
    setPendingContext,
    clearPendingContext,
    timelineContaining,
    getMessage,
    pathTo,
    childAnswerOf,
    historyOf,
    insertMessage,
    saveProgress,
    finishMessage,
    markInterrupted,
    insertCitations,
    contextOf,
    insertContext,
    defaultContext,
    explicitContext,
    promptCards,
    describeContext,
    citationLookup,
    messagesOfTimeline,
    tree,
  }
}

export type ChatRepository = ReturnType<typeof createChatRepository>
