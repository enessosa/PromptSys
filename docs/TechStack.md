# Tech stack

> **Status:** Project skeleton set up in `backend/` and `frontend/`; no features implemented yet.

## Overview

| Layer | Technology |
|---|---|
| Backend | Java 25, Spring Boot 4, Maven (details in [SpringBoot.md](SpringBoot.md)) |
| Frontend | React 19, TypeScript, Vite |
| Database | PostgreSQL |
| LLM | Anthropic Claude API |
| Deployment | Docker image (GHCR), self-hosted |

## Frontend

| Part | Technology |
|---|---|
| UI library | React 19 |
| Language | TypeScript 6 |
| Build tool / dev server | Vite 8 |
| Design system | Primer React (GitHub's design system) with Primer Primitives and Octicons |
| Routing | React Router 8 |
| Linting | ESLint 10 with typescript-eslint and React Hooks rules |

Same setup as MediaSystem. In development, `npm run dev` serves the app on http://localhost:5173.

## Architecture

PromptSys sits **in front of** the model: the backend assembles the context itself, so it knows exactly what was sent.

```
┌────────────┐      ┌─────────────────────────────┐      ┌───────────┐
│  Browser   │ ───▶ │  PromptSys                  │ ───▶ │  LLM API  │
│  (cards)   │ ◀─── │  registry · assembly · eval │ ◀─── │  (Claude) │
└────────────┘      └─────────────────────────────┘      └───────────┘
```

## Attribution dependencies

| Method | Requires | Version |
|---|---|---|
| Self-citation | Any API | v1 |
| Ablation (similarity) | Any API + embeddings | v1 |
| Ablation (likelihood) | Local / open-weights model (e.g. via Ollama) | Later |
