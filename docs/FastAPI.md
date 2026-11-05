# FastAPI setup

> **Status:** Project skeleton set up in `backend/` (health endpoint only); no features implemented yet. Settings and database migrations are not set up yet.

## Project basics

| Setting | Value |
|---|---|
| Language | Python 3.14 |
| Framework | FastAPI |
| Package manager | uv (`pyproject.toml`, `uv.lock`) |
| Project name | `promptsys-backend` |
| Base package | `app` |
| Config format | Environment variables / `.env` |

## Dependencies

### Core

| Library | Purpose |
|---|---|
| FastAPI (`fastapi[standard]`) | REST API for the React frontend, SSE (`StreamingResponse`) for streaming answers, OpenAPI spec and Swagger UI as the API contract for the frontend |
| Pydantic | Validates request bodies (cards, messages); installed with FastAPI |
| pydantic-settings | Typed configuration from environment variables and `.env` |
| SQLAlchemy | Persistence for conversations, messages and context cards |
| psycopg | PostgreSQL driver |
| Alembic | Versioned schema migrations, so the schema only changes through migrations |

### Security

Authentication uses **JSON Web Tokens (JWT) from the start**: the API is stateless, with no server-side sessions.

| Library | Purpose |
|---|---|
| PyJWT | Signs and validates tokens |

The backend issues the tokens itself: a login endpoint checks the credentials and returns a signed JWT, and a FastAPI dependency (`Depends`) validates the signature and expiry of the `Authorization: Bearer <token>` header on every later request. Tokens are signed with HS256 and a secret from `JWT_SECRET`, and they expire after a short lifetime.

### LLM

| Library | Purpose |
|---|---|
| anthropic | Chat with the Claude API, including streaming (`AsyncAnthropic`) |

Chat endpoints use `async def` together with the async client. A blocking call inside an `async def` endpoint would hold up all other requests.

### Developer tooling

| Library | Purpose |
|---|---|
| FastAPI CLI | `fastapi dev` restarts automatically during development; installed with `fastapi[standard]` |
| pytest | Tests |
| Ruff | Linting and formatting |

### Open decisions

| Topic | Note |
|---|---|
| Embeddings | Needed for similarity ablation, which is not part of the MVP. Anthropic offers no embeddings API, so a local model would avoid a second provider. Library not chosen yet |
| Integration tests | Should run against a real PostgreSQL. Setup not chosen yet |

## Package structure

Packages are organized by feature, not by layer: each package holds its own models, schemas, services and routes.

| Package | Content |
|---|---|
| `app.auth` | Login and JWT issuing |
| `app.card` | Context registry: cards with stable IDs (`c1`, `c2`, …) |
| `app.chat` | Conversations, messages, streaming chat endpoint (SSE) |
| `app.assembly` | Prompt assembly with ID-tagged context blocks |
| `app.citation` | Parsing of citation markers like `[c3]`, also during streaming |
| `app.llm` | Claude API access, API key check |
| `app.common` | Shared building blocks such as global error handling |
| `app/config.py` | Application settings |
| `app/main.py` | Application entry point |

Ablation (`Verification` in the README) is not part of the MVP and gets its own package later.

## Configuration

Settings are read from environment variables, or from `backend/.env` in local development. `.env` is never committed.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DB_URL` | Yes | PostgreSQL connection, e.g. `postgresql+psycopg://promptsys:promptsys@localhost:5432/promptsys` |
| `JWT_SECRET` | Yes | Signing key for JWTs (at least 256 bits) |
| `ANTHROPIC_API_KEY` | No | Claude API key. Without it the app starts, but chat and ablation do not work |
| `ANTHROPIC_MODEL` | No | Overrides the default model (`claude-opus-5-5`) |

## Development

Run all commands from `backend/`:

```bash
uv sync                          # install dependencies
docker compose up -d             # start PostgreSQL from compose.yaml
uv run fastapi dev app/main.py   # start the API with auto-reload
uv run pytest                    # run tests
uv run ruff check .              # lint
```

The API runs on http://localhost:8000, with Swagger UI at http://localhost:8000/docs.

## Build and deployment

- The backend is shipped as a Docker image. It needs its own `Dockerfile`, which does not exist yet.
- In production, Swagger UI and `/openapi.json` are disabled. This is not implemented yet.
- CI pushes the image to GHCR (see [TechStack.md](TechStack.md)).
