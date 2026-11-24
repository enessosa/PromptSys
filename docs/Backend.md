# Backend setup

> **Status:** Backend set up in `backend/`: validated settings, SQLite access with migrations, test setup, the card endpoints (cards, links, graph), prompt assembly, citation parsing, conversations with timelines, the streaming chat endpoint (SSE), regenerate/stop, search, merges with undo, text file upload and the Host/Origin check work. Settings, similarity ablation and derived rules work too.

## Project basics

| Setting | Value |
|---|---|
| Runtime | Node.js 26 |
| Language | TypeScript 6 |
| HTTP framework | Hono (with `@hono/node-server`) |
| Package manager | npm (`package.json`, `package-lock.json`) |
| Project name | `promptsys-backend` |
| Source folder | `src/` |
| Config format | Environment variables / `.env` |

TypeScript is the same language as the frontend, and Electron already ships Node.js, so the backend runs inside the desktop app without bundling a second runtime.

In development, Node runs the `.ts` files directly (type stripping), so no build step is needed. `npm run build` compiles to `dist/` for the desktop app. Because of type stripping, only erasable TypeScript syntax is allowed (no `enum`, no `namespace`), the same rule as in the frontend.

## Dependencies

### Core

| Library | Purpose |
|---|---|
| Hono | REST API for the React frontend, Server-Sent Events for streaming answers |
| `node:sqlite` | SQLite driver; built into Node.js, no extra dependency |
| Zod | Validation of settings and request bodies; the schemas double as TypeScript types |

### LLM

| Library | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Chat with the Claude API, streaming, structured outputs, tool use (derived rules) |
| `@huggingface/transformers` | Local sentence embeddings for the similarity ablation (loaded on first use only) |

### Developer tooling

| Library | Purpose |
|---|---|
| TypeScript | Type checking (`npm run typecheck`) and build (`npm run build`) |
| Vitest | Tests |
| ESLint with typescript-eslint | Linting, same setup as the frontend |

### Decisions and open points

| Topic | Status |
|---|---|
| Validation | Decided: Zod, used for settings (`src/common/config.ts`) and for request bodies, paths and queries (`src/common/validation.ts`) |
| Database access and migrations | Decided: no ORM. `node:sqlite` directly, one small repository per feature folder (prepared statements, no query builder), and an own migration runner (see [Database](#database)) |
| Login / JWT | Decided 2026-11-24: no login and no JWT in v1 (local, single-user app). The local API is protected by binding to `127.0.0.1` plus a Host/Origin check (see [3. Draft](phases/3.%20Draft.md#security)) |
| OpenAPI | Decided 2026-11-24: no generated spec in v1; the endpoint tables in [3. Draft](phases/3.%20Draft.md#api-design) are the contract, the frontend mirrors the types by hand |
| Embeddings | Decided 2026-11-24: local embeddings with `@huggingface/transformers` (Transformers.js) and `Xenova/all-MiniLM-L6-v2` (ONNX, about 25 MB), no second provider. Loaded lazily on first use (see [Ablation](#ablation-srcablation)) |

## Folder structure

Folders are organized by feature, not by layer: each folder holds its own routes, services and data access.

| Folder | Content |
|---|---|
| `src/auth` | Host/Origin check middleware `originGuard` (no login in v1) |
| `src/card` | Context registry: cards with stable IDs (`c1`, `c2`, …), versions, links, graph, merges (`merge.ts`), file upload (`upload.ts`) |
| `src/chat` | Conversations, timelines, messages, streaming chat endpoint (SSE), regenerate/stop, search (`schema.ts`, `repository.ts`, `generation.ts` for the stream, `routes.ts`, `search.ts`) |
| `src/assembly` | Prompt assembly with ID-tagged context blocks (pure function `assemblePrompt`) |
| `src/citation` | Parsing of citation markers like `[c3]`: streaming state machine and final re-parse |
| `src/ablation` | Similarity ablation: `embedding.ts` (embedder), `score.ts` (cosine, noise, labels), `service.ts`, `routes.ts` |
| `src/rules` | Derived rules: tool-use extraction (`service.ts`), `repository.ts`, `routes.ts`, `schema.ts` |
| `src/agent` | Agent mode: `runner.ts` (interface `AgentRunner`, `AgentEvent`), `sdk.ts` (real runner on `@anthropic-ai/claude-agent-sdk`, pure `mapSdkMessage` and `preToolUseDecision`), `fake.ts` (deterministic runner), `service.ts` (sessions, event log, approvals, binding), `routes.ts` |
| `src/settings` | Non-secret settings in the `settings` table, `GET/PUT /api/settings` |
| `src/llm` | Claude API access (`complete`, `callTool` for forced tool calls, `stream`), optional `temperature`, API key check, mapping of SDK errors to `llm_*` error codes |
| `src/db` | SQLite connection (`openDatabase`), migration runner (`migrate`) and `transaction` helper |
| `src/common` | Shared building blocks: settings (`config.ts`), error envelope (`errors.ts`), Zod helpers (`validation.ts`) |
| `migrations/` | Numbered SQL files (`0001_init.sql`, …), outside `src/` so they are plain files in development and in `dist/` |
| `src/app.ts` | `createApp({ db, llm, embedder?, security? })`: Hono app with all routes under `/api`; used by the server and by tests |
| `src/testing.ts` | Helpers for tests only: `createTestApp(llm?)` (in-memory database; `null` = no API key) and `createStubLlm(...replies)` (a reply is a text, a list of stream chunks such as `['see [c', '3]']`, a function that streams chunks itself and may throw, or `{ toolInput }` as the result of `callTool`) and `createFakeEmbedder()` (hashed bag of words, no model; `createTestApp(llm, embedder?)` uses it, so tests never download the model) |
| `src/main.ts` | Entry point: starts the HTTP server |

Tests sit next to the code they test (`*.test.ts`). A feature folder holds `schema.ts` (Zod schemas and types), `repository.ts` (SQL) and `routes.ts` (HTTP), e.g. `src/card`.

## Configuration

Settings are read from environment variables, or from `backend/.env` in local development (loaded by Node with `--env-file-if-exists`). `.env` is never committed.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port, default `8000` |
| `DB_URL` | No | Path of the SQLite file (default `promptsys.db` in the working directory) or `:memory:`; missing folders are created. The desktop app will set its own path |
| `ANTHROPIC_API_KEY` | No | Claude API key. Without it the app starts (with a warning), but chat and ablation do not work; `GET /api/health` reports `apiKeyConfigured: false` |
| `ANTHROPIC_MODEL` | No | Overrides the default model (`claude-opus-5-5`); a conversation can set its own `model` |
| `EMBEDDING_CACHE_DIR` | No | Folder for the downloaded embedding model. Default: a `models` folder next to the database file (`DB_URL`); for `:memory:` the system temp folder. Read in `src/ablation/embedding.ts`, not in `loadSettings()` |
| `NODE_ENV` | No | `production` switches off the Vite dev origins of the Host/Origin check (see below). Read in `main.ts` only |

`loadSettings()` validates all variables with Zod at startup. An empty value counts as not set; an invalid value (e.g. `PORT=abc`) stops the start with a readable message. `backend/.env.example` lists the variables; copy it to `.env` for local development. Secrets are never hard-coded.

The server binds to `127.0.0.1` only, so it is not reachable from the network.

## Database

- `openDatabase(url)` opens the file (or `:memory:`) and switches on `PRAGMA foreign_keys` (per connection) and, for files, WAL mode.
- Migrations are numbered files `backend/migrations/0001_description.sql`. `migrate(db)` runs at startup, applies every file whose version is not yet in the `schema_migrations` table (`version`, `name`, `applied_at`) in order, each in its own transaction; a failing migration is rolled back and stops the start. Versions must be unique. Applied migrations are never edited; a change is a new file (SQLite supports only limited `ALTER TABLE`, so changing a column means rebuilding the table).
- Repositories are factories (`createCardRepository(db)`) that return plain functions around prepared statements. Multi-step changes use `transaction(db, fn)`; no transaction stays open during an LLM call.
- Current schema: `0001_init.sql` with `cards`, `card_versions`, `card_links` and `card_merges` as in [3. Draft](phases/3.%20Draft.md#database-schema). `0002_chat.sql` adds `conversations`, `messages`, `timelines`, `message_cards` and `citations`. `0003_ablation_rules.sql` adds `derived_rules`, `ablation_runs` and `settings` (plus indexes) as in the Draft.

## API conventions

- All routes live under `/api` (e.g. `GET /api/health`). The Vite dev server proxies `/api` to the backend, so the browser needs no CORS; the same prefix lets the desktop app serve the frontend and the API from one server later.
- JSON in and out, camelCase; ids are plain integers (`3` is `c3` in the UI).
- Errors always use one envelope: `{ "error": { "code", "message", "details"?, "requestId" } }` (see [3. Draft](phases/3.%20Draft.md#error-format)). Routes throw `AppError(status, code, message, details?)`; `app.onError` turns it into the envelope, unexpected errors become `500 internal_error` without details. Unknown routes answer `404 not_found` in the same format.
- Implemented endpoints:

| Method and path | Purpose |
|---|---|
| `GET /api/health` | `{status, apiKeyConfigured}` |
| `GET /api/cards?query=&kind=&folder=&includeArchived=` | List (with `excerpt`, without `body`) |
| `POST /api/cards` | Create (`201`), writes version 1 |
| `GET /api/cards/:id` | One card with `body`, `links`, `backlinks`; `mergedInto` follows the merge chain to the surviving card |
| `POST /api/cards/upload` | Multipart `file` + optional `folderPath`: UTF-8 text files (text/*, Markdown, JSON, YAML, code …), PDF (`unpdf`) and DOCX (`mammoth`) as extracted text; type checked by extension and magic bytes, max. 10 MB and 500,000 characters of text → card with `kind: "file"` (`413 file_too_large`, `422 unsupported_file_type`, also for scanned PDFs without text) |
| `PATCH /api/cards/:id` | Change; new version only if title or body change; `ifVersion` for optimistic locking (`409 version_conflict`) |
| `DELETE /api/cards/:id` | Soft delete (archive), `204` |
| `POST /api/cards/:id/restore` | Restore an archived card |
| `GET /api/cards/:id/versions` | Version history |
| `POST /api/links`, `PATCH /api/links/:id`, `DELETE /api/links/:id` | Links between cards (`related`, `derived_from`, `part_of`, `contradicts`); no self-links, no duplicates (`related` counts as undirected); links to archived or merged cards → `409 card_archived` |
| `GET /api/graph?folder=&kind=` | Nodes (with position and degree) and the links between them |
| `PUT /api/graph/positions` | Save node positions in one batch |
| `POST /api/merges/preview` | `{targetId, sourceIds}` → `{title, body, linkCount}` |
| `POST /api/merges` | `{targetId, sourceIds, title, body}` → `201 {target, merges}` in one transaction |
| `POST /api/merges/:id/undo` | Undoes the **whole** merge operation (any merge id of it) → `{target, restored: Card[]}`; `409 merge_outdated` if the target was edited after the merge, `409 merge_already_undone`, `404 merge_not_found` |

Merge details (`src/card/merge.ts`): the surviving target gets the merged text as a new version; each source gets `merged_into_id` + `archived_at` and one `card_merges` row (snapshot, `source_links` JSON with `moved: true/false` per link, `target_version_before`). Links keep their id and are re-pointed; duplicates and self-links are dropped. If any source was `default_included`, the target becomes `default_included`. One operation = all `card_merges` rows with the same `target_id` and `target_version_before`. Undo restores the sources with their links (links to cards archived in the meantime are not restored) and sets the target back to the text of `target_version_before` as a new version. Errors: `400 invalid_merge` (target in sources, empty sources, archived/merged cards), `404 card_not_found`.

Chat endpoints (details below):

| Method and path | Purpose |
|---|---|
| `GET /api/conversations`, `POST /api/conversations`, `GET/PATCH/DELETE /api/conversations/:id` | Conversations (`POST` creates the first timeline `main`, which is the active one). `DELETE` is hard delete incl. messages (`409 generation_running` while an answer streams) |
| `GET /api/conversations/:id/tree` | `{timelines, messages: [{id, parentId, role, status, excerpt, timelineIds}]}` for the branch view |
| `POST /api/conversations/:id/timelines` | `{fromMessageId, name?}`: new branch that starts after an answer (`fromMessageId` must be an assistant message) |
| `GET /api/timelines/:id/messages` | The path root → head with `context`, `citations`, `usedCardIds`, `unusedCardIds`, `invalidMarkers` |
| `POST /api/conversations/:id/context-preview` | `{timelineId, content?, cards?}` → `{cards, estimatedInputTokens, droppedCardIds, prompt: {system, messages}}` |
| `POST /api/timelines/:id/messages` | `{content, cards?}` → SSE |
| `POST /api/messages/:id/regenerate` | `{excludeCardIds?}` → SSE |
| `POST /api/messages/:id/stop` | `204`; `:id` is the assistant message id (also `204` if it is not running) |
| `GET /api/search?q=` | `{cards: [{id, title, kind, folderPath, excerpt}], conversations: [{id, title, updatedAt}]}`, at most 20 each |

Settings, ablation and rules endpoints are listed in [Settings](#settings), [Ablation](#ablation-srcablation) and [Derived rules](#derived-rules-srcrules). Not implemented yet: `inContext` in the graph.

## Chat

### Context and timelines

- The context state belongs to the **user message** (`message_cards`, with the exact `card_version`). `cards` in a request is the **complete** state for this turn (list order = prompt order, `excluded` cards are saved but not sent). Without `cards` the default is used: the context of the nearest user message above the timeline head, brought up to date (current card versions; a merged-away card is replaced by its target; archived cards are dropped), or for the first message the cards with `default_included = 1`.
- Errors for `cards`: unknown card `404 card_not_found`, archived `409 card_archived`, merged-away `409 card_merged`, duplicate `400 validation_failed`.
- A timeline's messages are the path from `head_message_id` to the root. Sending appends a user message and an assistant message and moves the head. A conversation's title is set from the first message while it is still `New conversation`.
- **Regenerate** takes an assistant message. Without `excludeCardIds` the new answer is a sibling of the old one (same user message, same context). With excluded cards, the question is **copied** as a new user message (`replay_of_id` = original, same parent) with the changed context, because the context state belongs to the user message. In both cases a new timeline is created (`parent_timeline_id` = first timeline containing the old answer, `change_summary` e.g. `excluded c2`) and becomes the conversation's `activeTimelineId`. The stored card versions of the original turn are reused, not the current ones. `excludeCardIds` must name cards of that turn's context.
- History for the prompt: all messages of the path above the new question; empty answers (failed before the first token) are skipped.
- Only one answer per timeline at a time: `409 generation_running`. Answers left in `streaming` by a crashed process are marked `error` / `interrupted` at startup.

### Prompt assembly (`src/assembly`)

`assemblePrompt({systemPrompt, cards, history, userContent?, maxInputTokens?})` is a pure function and the only place that builds the prompt; preview and real request call it with the same input. The format is the one in [3. Draft](phases/3.%20Draft.md#prompt-assembly-format): instructions, `<context>` with `<card id="cN" kind=… title=…>` blocks (pinned first, then position, then id; titles XML-escaped, only `</card>` and `</context>` escaped in bodies), then the conversation's own system prompt. Card text comes from `card_versions` (the saved version), not from the live card.

- Token estimate: `ceil(characters / 4)` over system prompt and messages. The budget is 150 000 tokens (`DEFAULT_INPUT_BUDGET`); over it, `included` cards are dropped from the end of the order and reported as `droppedCardIds` (in the preview and in `message_start`); if pinned cards, history and message alone are too large: `400 validation_failed`, nothing is saved. The Draft says "the model's context window"; one fixed budget is used until models carry their own limits.
- `max_tokens` of the answer is 4096 (fixed in `src/llm`).

### Citations (`src/citation`)

- Marker pattern `\[c(\d{1,9})\]` (at most 12 characters; longer digit runs are not markers). The streaming `StreamingCitationParser` holds back `[`, `[c`, `[c3`… while the buffer could still become a marker (up to 11 characters) and releases it as text when the pattern breaks; `flush()` at the end. The `citation` event comes right after the `text_delta` that contains the marker; `start`/`end` are UTF-16 offsets in the final text.
- After the stream, the saved text is parsed again (`findMarkers`); this re-parse is the source of the `citations` rows. A marker is valid if its card is in the prompt (`included`/`pinned`); a merged-away card that is not itself in the prompt counts as its merge target. Unknown cards are stored with `card_id = NULL` and `valid = 0`; existing cards that were not sent (e.g. excluded) keep their `card_id` with `valid = 0`.
- `unusedCardIds` = cards that were really sent without a valid citation.

### SSE stream

`message_start`, `text_delta`, `citation`, `message_stop`, `error` as in [3. Draft](phases/3.%20Draft.md#sse-event-format), plus `: ping` every 15 s. Additions: `message_start` has `droppedCardIds` and lists only the cards actually sent. Details:

- Failures before the stream starts (validation, `404`, `409`, `424 api_key_missing`, `400` budget) are normal JSON errors with the matching HTTP status; failures during the stream are an `error` event (`llm_rate_limited`, `llm_timeout`, `llm_error`, `internal_error`). Text that was held back for a possible marker is released before the `error` event; the partial answer is saved with `status: "error"` and `errorCode`.
- Stop (`/stop` or closed connection): the Anthropic request is aborted, the answer saved as `stopped` (text that was not yet sent to the client is not saved), the stream ends without further event.
- Persistence: user message, its context rows and the empty assistant row (`streaming`) in one short transaction; progress saved about every second; at the end one short transaction for the final text and the `citations` rows. No transaction is open while waiting for the model.
- Input tokens: from the API usage, estimated (chars / 4) if missing.

## Replay and branches (`src/chat/replay.ts`, `src/chat/context-changes.ts`)

- Migration `0004_replay.sql` adds `timeline_context`: the context of a branch that has no user message of its own yet. The first user message on that timeline takes it over and the rows are deleted; `message_cards` stays the source of truth per user message.
- Branch rule: `POST /api/conversations/:id/timelines` `{fromMessageId, name?, contextChanges?}`. From an assistant message the branch point is that message; from a user message (also the first one) it is its parent (`null` for the first message). `contextChanges = {cards: [{cardId, state}], editedCards: [{cardId, title?, body?}]}`; a card not yet in the context is added; an edit creates a **forked card** (`forked_from_id`, version 1, `derived_from` link to the original) that replaces the original at the same position in this branch only. `change_summary` e.g. `excluded c2, included c3, edited c1 → c4, added c5`.
- Replays: `POST /api/replays` `{fromMessageId, contextChanges?, mode: "step"|"auto", dryRun?, sourceTimelineId?, name?}` → `{timeline, pendingPrompts: [{messageId, content}], estimatedApiCalls}` (`201`; `dryRun` → `200` with `timeline: null`, nothing created; doubled calls when derived rules are on; `400` without following prompts).
- `POST /api/replays/:timelineId/next` `{action: "send"|"edit"|"skip", content?}`: `send`/`edit` → normal chat SSE; `skip` → `{timeline}`. `POST /api/replays/:timelineId/auto` → SSE with `progress {done,total}` between answers, the normal events of each answer and a final `replay_finished {timelineId, status, done, total}`; stop endpoint or closing the stream → `cancelled`; an error → `error` event, then `replay_finished` with `status: "paused"`. `POST /api/replays/:timelineId/branch-off` and `/cancel` → `{timeline}`.
- State machine: `paused` → `running` (auto only) → `finished` / `cancelled` / `paused` (error); `paused` → `finished` (last prompt) / `branched_off` / `cancelled`. Anything else: `409 replay_not_active`. A free message on a timeline whose replay is `paused`/`running`: `409 replay_active` (branch off or cancel first). A `running` replay without a live stream (after a restart) counts as `paused`. Replayed user and assistant messages carry `replay_of_id` (the original). The active timeline is not switched automatically; the frontend sets it with `PATCH /api/conversations/:id`.
- `GET /api/conversations/:id/tree`: timelines with `branchPointId`, `parentTimelineId`, `changeSummary`, `replayStatus`, `replayMode`, `replaySourceId`, `replayNextId`; messages with `id, parentId, role, status, excerpt, timelineIds, replayOfId`.
- `GET /api/timelines/:a/compare/:b` → `{commonBranchPointId, a: {timeline, messages}, b: {timeline, messages}, pairs: [{a, b}]}` from the common branch point on, paired by `replayOfId` (`400` for different conversations).
- `generation.ts`: `runGeneration` (several answers in one stream, used by auto replay) and `streamGeneration` with optional `onFinish`.

## Settings

`GET /api/settings` returns all settings, `PUT /api/settings` merges the given fields (partial body) and returns all of them. Values are stored as JSON in the `settings` table; a stored value that no longer validates falls back to its default. Unknown keys (and so secrets such as an API key) are rejected with `400 validation_failed`.

| Field | Type | Default |
|---|---|---|
| `defaultModel` | string or `null` (`null` = `ANTHROPIC_MODEL`) | `null` |
| `ablationRuns` (`n`) | integer 1..10 | `3` |
| `baselineRuns` (`k`) | integer 0..10 | `3` |
| `ablationTemperature` | number 0..1 | `0.2` |
| `accentColor` | `#rrggbb` or `null` | `null` |
| `mode` | `api` or `claude_code` | `api` |
| `codeAuth` | `local_login` or `api_key` | `local_login` |

## Agent mode (`src/agent`)

A second mode (`mode = claude_code`) shares the card library and the graph. The main view is a coding-agent session that runs through `@anthropic-ai/claude-agent-sdk` with the user's own local Claude Code login (PromptSys never sees or stores the login). With `codeAuth = local_login` the environment given to the SDK has `ANTHROPIC_API_KEY` removed; `api_key` passes it through. Migration `0005_code_mode.sql` adds `code_sessions`, `code_events` and the card columns `origin` (`agent` or `NULL` for user cards), `review_status` (`proposed`, `confirmed`, `corrected`, `rejected`) and `code_session_id`. At startup, sessions left in `running` or `waiting_approval` are set to `stopped`.

- `AgentRunner` (`runner.ts`) is the only thing the service knows. `createSdkRunner()` is the real one; `createFakeRunner()` (selected with `PROMPTSYS_FAKE_AGENT=1`) answers deterministically without network or disk access, for tests and end-to-end tests. `createApp({ agentRunner })` overrides the runner.
- The SDK runner loads user and project settings (`settingSources: ['user', 'project']`, so skills and slash commands work), uses the `claude_code` system prompt preset with card instructions appended, and offers the tools `record_card` and `link_cards` through an in-process MCP server (`promptsys`). A `PreToolUse` hook is the approval gate: `Read`, `Glob`, `Grep`, `LS`, `TodoWrite` and the own `mcp__promptsys__*` tools run on their own, everything else waits for the user's answer.
- One running turn per session (`409 session_busy`), any number of sessions in parallel. Every event is stored in `code_events` (`seq` counts up per session) and sent to SSE subscribers.
- Binding: confirmed and corrected agent cards of the same project path are put in front of the prompt as a `<promptsys-cards>` block (`[cN] title: body`). Not for prompts that start with `/` (a slash command has to stay first). `proposed` and `rejected` cards are never injected.
- Agent cards are `note` cards in the folder `<project folder name>/<folder>`; `record_card` takes an optional `folder` (sanitised, `..` dropped), and the tool `find_cards` (text search over the library, or the project folder's cards without a query) lets the agent avoid duplicates and reuse folders. `[cN]` references in a user message add those cards (title, folder, body up to 8000 characters, at most 20) to the prompt's `<promptsys-cards>` block under "Referenced by the user in this message". Card responses (`/cards`, `/cards/:id`, `/graph` nodes) have `origin` and `reviewStatus` (`null` for user cards).

| Endpoint | Description |
|---|---|
| `GET /api/code/status` | `{ available, reason?, mode, codeAuth }`; works in both modes |
| `GET /api/code/sessions` | Sessions `{ id, title, projectPath, status, permissionMode, createdAt, updatedAt }` |
| `POST /api/code/sessions` | `{ projectPath, title? }` → `201`; `422 invalid_project_path` unless it is an absolute path to an existing folder; the title defaults to the folder name |
| `GET /api/code/sessions/:id` | `{ session, slashCommands, events: [{ seq, type, payload, createdAt }] }` |
| `PATCH /api/code/sessions/:id` | `{ title?, permissionMode? }` (at least one) → the session. `permissionMode`: `default` (Ask), `acceptEdits` (Edit/Write/NotebookEdit/MultiEdit with a path inside the project run without asking), `plan` (SDK plan mode), `auto` (SDK decides; the hook gives no decision and what the SDK still asks reaches the user through `canUseTool` and the approval flow). `bypassPermissions` is not offered. Persisted (migration `0006_code_permission_mode.sql`), also applied to a running turn (`Query.setPermissionMode`), emits a `mode` event |
| Stream events `mode`, `context`, `usage`, `plan_usage` | `mode { mode }` when the permission mode changes; `context { percentage, totalTokens, maxTokens }` after each turn (SDK `getContextUsage`, else computed from the result's `modelUsage`); `usage { input, output, cacheRead, cacheCreation }` tokens of that turn (from the result's `usage`; the session total is the sum over these events); `plan_usage { fiveHour?, sevenDay?: { utilization, resetsAt }, subscriptionType }` plan rate limits (experimental SDK usage API, 5 s timeout; not emitted for API keys or on failure) |
| `GET /api/code/plan-usage` | Account-wide plan limits: the newest `plan_usage` payload of any session plus `observedAt`, or `null` before the first report. Shown once under the session list, since per-session values of different ages would contradict each other. |
| `DELETE /api/code/sessions/:id` | `204`, stops a running turn |
| `GET /api/code/sessions/:id/git` | `{ isGitRepo, branch?, dirty? }` (`git` via `execFile`, no shell, `cwd` = project; a non-git folder gives `{ isGitRepo: false }`) |
| `GET /api/code/sessions/:id/changes` | `{ isGitRepo, files: [{ path, oldPath?, status, added, removed, diff, truncated }] }`; `status` is `modified`, `added`, `deleted`, `untracked` or `renamed`; uncommitted changes against `HEAD` (staged, unstaged, untracked) with a unified diff per file, cut at 200 KB (`truncated`) |
| `POST /api/code/sessions/:id/messages` | `{ text }` → `202 { accepted: true }`; `409 session_busy` |
| `GET /api/code/sessions/:id/stream` | SSE; per event `event: <type>`, `data: { seq, ...payload }`. Load the history first, then subscribe and ignore `seq` that you have seen |
| `POST /api/code/sessions/:id/approvals/:approvalId` | `{ allow, message? }` → `204`; `404 approval_not_found` |
| `POST /api/code/sessions/:id/stop` | `204`; aborts the turn and denies open approvals (status `stopped`) |
| `GET /api/code/sessions/:id/cards` | Agent cards of the session `{ id, title, body, reviewStatus, version }` |
| `PATCH /api/code/cards/:id` | `{ reviewStatus?: 'confirmed' \| 'rejected', title?, body? }`; changed text writes a new card version and sets `corrected` |

Event types: `user`, `init`, `text`, `tool_call`, `tool_result`, `approval_request`, `approval_resolved`, `card` (`action: created` for a new card, `linked` with the `cardId` of a card that got a link), `status`, `result`, `error`.

Mode gating: all `/api/code/*` routes except `status` answer `409 feature_requires_claude_code_mode` in `api` mode. In `claude_code` mode these answer `409 feature_requires_api_mode`, because PromptSys would create extra requests itself: starting an ablation (not the dry run), a replay with `mode: 'auto'` and `POST /api/replays/:timelineId/auto`. Step-by-step replay and the explicit rules button (`POST /api/messages/:id/rules`) stay available; there is no automatic rule extraction in the backend.

## Ablation (`src/ablation`)

Answers "does this card change the answer?" by regenerating the answer without the card and comparing both answers with local embeddings.

| Method and path | Purpose |
|---|---|
| `POST /api/messages/:id/ablations` | `:id` is the assistant answer. Body `{cardIds, runs?, baselineRuns?, dryRun?}`. `dryRun: true` answers `{messageId, cardIds, runs, baselineRuns, reusedBaselineRuns, estimatedApiCalls}` (`estimatedApiCalls = k + n x cards`, minus baseline runs that are reused). Otherwise an SSE stream (below) |
| `GET /api/messages/:id/ablations` | `{messageId, baseline: {runs, noise, answers}, cards: [{cardId, runs, change, noise, noiseMeasured, effect, label, explanation, answers: [{runIndex, answer, similarity}]}]}`; `baseline.noise` is `null` without baseline runs |

- Validation (before anything is sent): `400 validation_failed` if the message is not a finished answer, a card was not sent with the question of this answer (not in the context as `included`/`pinned`, or dropped for the token budget), `cardIds` is empty or has duplicates; `404 message_not_found`; `424 api_key_missing` (also for `dryRun`).
- SSE events: `progress {done, total, cardId?}` after every API call (baseline runs have no `cardId`), `ablation_result` (the same object as one entry of `cards` in the GET) after the last run of each card, then `message_stop {messageId, apiCalls}`; a failure is an `error` event with the usual envelope (`llm_rate_limited`, `llm_timeout`, `llm_error`, `internal_error`) and the stream ends. Runs stored before the failure stay. Order: original answer embedded first (a broken embedding model fails before any API call is spent), then the baseline runs, then the cards one by one. A second ablation of the same answer at the same time: `409 generation_running`. Closing the connection stops after the current run.
- Regeneration: `assemblePrompt` with the same system prompt, history and question as the original turn and the stored card versions, minus the card; `complete()` at `ablationTemperature` with the model of the original answer. Baseline runs use the full context. Every run is saved in `ablation_runs` (answer, cosine similarity to the original, temperature, model, tokens). No transaction is open during the LLM and embedding calls.
- A new ablation of a card replaces its earlier runs. Existing baseline runs are reused if there are at least `k` of them (they cost nothing, so `estimatedApiCalls` is lower); fewer are topped up.
- Score (`score.ts`): `change = 1 - mean cos(a_i, o)`, `noise = 1 - mean cos(b_j, o)` from the baseline runs (0 and `noiseMeasured: false` if there are none), `effect = max(0, change - noise)`. Label: `within_noise` if `change <= noise + 0.02`, else `strong` if `effect >= 0.10`, else `weak`. Both thresholds (`NOISE_MARGIN`, `STRONG_EFFECT`) are provisional and constants in `score.ts`; they should be tuned with real runs.
- No control run in v1. For `within_noise` the `explanation` reads "No effect: card not needed or model already knew it." (the ablation cannot tell the two apart).
- Embeddings (`embedding.ts`): interface `Embedder { embed(texts): Promise<number[][]> }`, injected through `createApp({ embedder })`. The default `createTransformersEmbedder({cacheDir})` imports `@huggingface/transformers` and loads `Xenova/all-MiniLM-L6-v2` on the first call (download once, then offline); a failed load is retried on the next call. The model reads about 256 word pieces, so longer texts are split into chunks of about 1000 characters, embedded separately and averaged (unit length). Checked with Node 26: the model loads and embeds.

## Derived rules (`src/rules`)

The model states which rules an answer relied on. The stated source is the model's own report, so every rule carries `source.reliability: "claimed"` (like self-citation, not measured).

| Method and path | Purpose |
|---|---|
| `POST /api/messages/:id/rules` | Extracts the rules of an answer with a forced `report_rules` tool call (input: question, answer and the cards that were sent). Replaces the still `proposed` rules of this answer, keeps decided ones. → `{rules: DerivedRule[], warning?}`; malformed or missing tool output gives `rules: []` and a `warning` instead of an error; unusable entries (empty text, `kind: "card"` without a sent card) are skipped with a `warning`. `424 api_key_missing` |
| `GET /api/conversations/:id/rules?includeRejected=` | `DerivedRule[]`, rejected ones only with `includeRejected=true` |
| `PATCH /api/rules/:id` | `{status: "confirmed" \| "rejected"}` → `{rule}`; `{status: "corrected", text}` → `{rule, card}`: creates a card `kind: "rule"` (`defaultIncluded: true`, title = first line of the text, `derived_from` link from the new card to the source card if that card is still alive) and sets `cardId`. A corrected rule cannot be changed again (`400`) |
| `POST /api/rules/:id/card` | "Save as card" for a **confirmed** rule: creates the same kind of rule card, the rule stays `confirmed`, `201 {rule, card}`; once per rule |

`DerivedRule = {id, conversationId, messageId, text, status: proposed|confirmed|corrected|rejected, source: {kind: "card"|"prior_knowledge", cardId, reliability: "claimed"}, cardId, createdAt}`. Rules are created and cards written in one short transaction each; the LLM call happens before.

## Deviations from the Draft

- **Derived rules are not part of the chat SSE.** The Draft sends them as `rule` events after the answer when `show_derived_rules` is on. In v1 the frontend calls `POST /api/messages/:id/rules` itself after the answer (explicit opt-in, one extra API call, easy to show in the status bar). `conversations.show_derived_rules` is only stored; the frontend decides when to call.
- `GET /api/settings` / `PUT` accept partial bodies; `PUT` merges.
- `EMBEDDING_CACHE_DIR` is read in `embedding.ts`, not in `loadSettings()`.
- The dry run needs an API key (`424`) like the real run.
- Existing baseline runs are reused, so `estimatedApiCalls` can be below `k + n x cards`.

## Host/Origin check (`src/auth`)

`originGuard({port, development})` runs on every request (also unknown routes) and answers `403 forbidden_origin` if the `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`, or if an `Origin` header is present and is not `http://127.0.0.1:<port>` / `http://localhost:<port>`. Requests without `Origin` pass. Unless `NODE_ENV=production`, the Vite dev server is also accepted (`localhost:5173`, `127.0.0.1:5173` as `Host` and `Origin`), because the Vite proxy forwards the browser's `Host` header unchanged. `createApp` only installs the guard when `security` is passed; `main.ts` always does, tests leave it out (`app.request` sends no `Host` header) except in `src/auth/auth.test.ts`.

## Development

Run all commands from `backend/`:

```bash
npm install          # install dependencies
npm run dev          # start the API with auto-restart on changes
npm test             # run tests
npm run lint         # lint
npm run typecheck    # type check without building
npm run build        # compile to dist/ (without tests)
```

The API runs on http://127.0.0.1:8000. Typecheck and lint cover the tests too; the build (`tsconfig.build.json`) leaves them out.

## Build and deployment

- The backend is shipped inside the Electron desktop app (see [6. Hosting](phases/6.%20Hosting.md)).
