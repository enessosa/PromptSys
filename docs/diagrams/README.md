# PromptSys diagrams

PlantUML sources (`.puml`) with SVG renderings (dark mode, rendered with `plantuml -tsvg --dark-mode -failfast2`).

## PromptSys - Container Diagram
C4 container view: frontend, backend, SQLite, local embedding model, Claude API, the user-installed Claude Code CLI (Agent mode) and the Electron shell.

![PromptSys - Container Diagram](architecture-c4.svg)

Source: [architecture-c4.puml](architecture-c4.puml)

## Backend feature folders - imports between modules
Dependencies between the backend feature folders (including the new agent module), taken from the real imports.

![Backend feature folders](backend-package.svg)

Source: [backend-package.puml](backend-package.puml)

## Send a message - streamed answer with citations
`POST /api/timelines/:id/messages` through prompt assembly, LLM stream, citation parser and SSE events to persistence.

![Send a message](chat-sequence.svg)

Source: [chat-sequence.puml](chat-sequence.puml)

## "Why?" ablation - dry run, confirm, runs, score
Dry-run estimate, confirmation, baseline and card runs with local embeddings, and the scoring.

![Why ablation](ablation-sequence.svg)

Source: [ablation-sequence.puml](ablation-sequence.puml)

## Agent mode - one turn with approval and record_card
`POST /api/code/sessions/:id/messages` through the card block, runner and Claude Code CLI, stored and streamed events, the tool approval round-trip and `record_card`.

![Agent turn](agent-turn-sequence.svg)

Source: [agent-turn-sequence.puml](agent-turn-sequence.puml)

## Database schema (migrations 0001-0006)
All 15 tables with their foreign keys, including agent sessions, their event log and the review fields of agent cards.

![Database schema](database-er.svg)

Source: [database-er.puml](database-er.puml)

## Desktop app - processes, windows and local data
Electron main process, backend utility process, renderer windows, the files in userData and the user-installed Claude Code CLI.

![Desktop deployment](desktop-deployment.svg)

Source: [desktop-deployment.puml](desktop-deployment.puml)
