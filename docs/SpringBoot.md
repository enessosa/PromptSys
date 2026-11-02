# Spring Boot setup

> **Status:** Project generated in `backend/` (Spring Boot 4.1.2, Spring AI 2.0.1); no features implemented yet.

## Project basics

| Setting | Value |
|---|---|
| Build tool | Maven |
| Language | Java 25 (LTS) |
| Spring Boot | Latest stable 4.x |
| Packaging | Jar |
| Group / artifact | `dev.promptsys` / `promptsys-backend` |
| Base package | `dev.promptsys` |
| Config format | `application.yaml` |

## Dependencies

### Core

| Starter / library | Purpose |
|---|---|
| Spring Web | REST API for the React frontend, SSE (`SseEmitter`) for streaming answers |
| Validation | Validates request bodies (cards, messages) |
| Spring Data JPA | Persistence for conversations, messages and context cards |
| PostgreSQL Driver | Database driver |
| Flyway Migration | Versioned schema migrations, so Hibernate never changes the schema |
| Spring Boot Actuator | Health endpoint for Docker / self-hosting |

### Security

Authentication uses **JSON Web Tokens (JWT) from the start**: the API is stateless, with no server-side sessions.

| Starter / library | Purpose |
|---|---|
| Spring Security | Protects all API endpoints |
| OAuth2 Resource Server | Built-in JWT validation (Nimbus): checks signature and expiry of the `Authorization: Bearer <token>` header |

The backend issues the tokens itself: a login endpoint checks the credentials and returns a signed JWT (`JwtEncoder`), and every later request is validated by the resource server (`JwtDecoder`). Tokens are signed with HS256 and a secret from `JWT_SECRET`, and they expire after a short lifetime.

### LLM

| Starter / library | Purpose |
|---|---|
| Spring AI Anthropic | Chat with the Claude API, including streaming |
| Spring AI Transformers (ONNX) | Local embeddings for similarity ablation. Anthropic offers no embeddings API, so this avoids a second provider |

Spring AI also has an Ollama starter, which covers the later step to a local model for likelihood attribution.

### Developer tooling

| Starter / library | Purpose |
|---|---|
| Spring Boot DevTools | Automatic restart during development |
| Docker Compose Support | Starts PostgreSQL from `compose.yaml` on `mvn spring-boot:run` |
| Testcontainers (PostgreSQL) | Integration tests against a real PostgreSQL |
| springdoc-openapi | OpenAPI spec and Swagger UI as the API contract for the frontend |

### Deliberately left out (for now)

| Library | Reason |
|---|---|
| Spring WebFlux | Spring MVC with virtual threads and SSE is enough for streaming and keeps the code blocking and simple |
| Lombok | Java records cover DTOs; entities stay plain |

## Package structure

Packages are organized by feature, not by layer: each package holds its own entities, repositories, services and controllers.

| Package | Content |
|---|---|
| `dev.promptsys.auth` | Login and JWT issuing |
| `dev.promptsys.card` | Context registry: cards with stable IDs (`c1`, `c2`, …) |
| `dev.promptsys.chat` | Conversations, messages, streaming chat endpoint (SSE) |
| `dev.promptsys.assembly` | Prompt assembly with ID-tagged context blocks |
| `dev.promptsys.citation` | Parsing of citation markers like `[c3]`, also during streaming |
| `dev.promptsys.llm` | Claude API access via Spring AI, API key check |
| `dev.promptsys.config` | Cross-cutting configuration (security filter chain, JWT encoder/decoder) |
| `dev.promptsys.common` | Shared building blocks such as global error handling |

Ablation (`Verification` in the README) is not part of the MVP and gets its own package later.

## Configuration

### `application.yaml`

```yaml
spring:
  application:
    name: promptsys
  threads:
    virtual:
      enabled: true          # one virtual thread per request, cheap blocking calls to the LLM
  datasource:
    url: ${DB_URL:jdbc:postgresql://localhost:5432/promptsys}
    username: ${DB_USER:promptsys}
    password: ${DB_PASSWORD:promptsys}
  jpa:
    open-in-view: false
    hibernate:
      ddl-auto: validate     # schema is owned by Flyway
  flyway:
    enabled: true
  ai:
    anthropic:
      api-key: ${ANTHROPIC_API_KEY:}   # optional: the app starts without it, LLM calls fail until it is set
      chat:
        options:
          model: ${ANTHROPIC_MODEL:claude-opus-5-5}
          temperature: 0.2   # low temperature reduces noise between ablation runs

promptsys:
  jwt:
    secret: ${JWT_SECRET}    # at least 256 bits for HS256
    expiration: 1h

management:
  endpoints:
    web:
      exposure:
        include: health,info
```

### Profiles

| Profile | Use |
|---|---|
| `dev` | Local development: Docker Compose PostgreSQL, SQL logging, Swagger UI enabled |
| `prod` | Docker image: all values from environment variables, Swagger UI disabled |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | No | Claude API key, never committed. Without it the app starts, but chat and ablation do not work |
| `ANTHROPIC_MODEL` | No | Overrides the default model |
| `JWT_SECRET` | Yes | Signing key for JWTs (at least 256 bits), never committed |
| `DB_URL` / `DB_USER` / `DB_PASSWORD` | In `prod` | PostgreSQL connection |

## Build and deployment

- `mvn spring-boot:build-image` builds the Docker image with Cloud Native Buildpacks, so no Dockerfile is needed for the backend.
- CI pushes the image to GHCR (see [TechStack.md](TechStack.md)).
