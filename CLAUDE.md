# CLAUDE.md — opuspopuli (main monorepo)

## Quick reference

```bash
# From repo root
pnpm install
docker compose up -d          # Supabase, Ollama, Redis, Inbucket
pnpm dev                      # All services in parallel

# Backend (from apps/backend/)
pnpm start:api                # API Gateway   :3000
pnpm start:users              # Users         :3001
pnpm start:documents          # Documents     :3002
pnpm start:knowledge          # Knowledge     :3003
pnpm start:region             # Region        :3004
pnpm test                     # Jest unit tests
pnpm test:integration         # Requires docker compose up

# Frontend (from apps/frontend/)
pnpm dev                      # Dev server    :3200
pnpm test
pnpm e2e                      # Playwright
pnpm cf:deploy                # Build + deploy to Cloudflare Pages
```

Each `start:*` script builds before starting watch mode — don't run `nest start` directly.

## Git workflow

- **Base branch**: `develop`. All feature/fix branches cut from `develop`, PR back to `develop`.
- **main** is production-only. Promote via a release PR (`develop → main`) using `/op-release`.
- Never push directly to `develop` or `main`.
- Branch naming: `feat/<short-description>-<issue#>`, `fix/<short-description>-<issue#>`, `chore/<short-description>`

## Architecture overview

**Microservices** (NestJS, GraphQL Federation):

| Service | Port | Owns |
|---------|------|------|
| `api` | 3000 | Apollo Gateway — federated GraphQL endpoint |
| `users` | 3001 | Auth, profiles, passkeys (WebAuthn), magic links |
| `documents` | 3002 | Document storage, petition scanning, OCR, activity feed |
| `knowledge` | 3003 | RAG pipeline — embeddings, vector search, LLM inference |
| `region` | 3004 | Civic data — propositions, meetings, representatives, campaign finance |

**Workspace packages** (`packages/`): `auth-provider`, `common`, `config-provider`, `email-provider`, `embeddings-provider`, `extraction-provider`, `llm-provider`, `logging-provider`, `ocr-provider`, `prompt-client`, `region-provider`, `relationaldb-provider`, `scraping-pipeline`, `secrets-provider`, `storage-provider`, `vectordb-provider`

**Provider pattern**: swap implementations via env vars, never code changes.

| Env Var | Default | Alternatives |
|---------|---------|-------------|
| `EMBEDDINGS_PROVIDER` | `xenova` | `ollama` |
| `LLM_MODEL` | `qwen3.5:9b` | any Ollama model |
| `STORAGE_PROVIDER` | `supabase` | `cloudflare` (R2) |

**Auth**: httpOnly cookies + CSRF double-submit. API Gateway validates CSRF and signs microservice requests with HMAC-SHA256 (`X-HMAC-Auth`). GraphQL depth limit 10, complexity limit 1000.

**TypeScript paths** (root `tsconfig.json`):
- `@backend/*` → `./apps/backend/apps/*`
- `@frontend/*` → `./apps/frontend/app/*`

## Prompt templates — IP boundary

**Prompt template text lives exclusively in the private `prompt-service` repo.** Never write prompt text inline or hard-code it in this repo.

Consume prompts via `@opuspopuli/prompt-client`:
```typescript
const { promptText } = await this.promptClient.getDocumentAnalysisPrompt({ documentType: 'my-type', text });
const { promptText } = await this.promptClient.getCivicsExtractionPrompt({ regionId, sourceUrl, contentGoal, html });
```

Available prompt types: `getStructuralAnalysisPrompt`, `getDocumentAnalysisPrompt`, `getRagPrompt`, `getCivicsExtractionPrompt`.

## Database migrations

Migrations live in `supabase/migrations/`. Use the `/op-migration` skill to generate them.

Rules:
- **Additive only** on existing tables in production. Never drop columns or rename them in a single migration — deprecate, then remove in a follow-up after deploy.
- Secrets go in Supabase Vault. Never store credentials in migration SQL or `.env` files committed to the repo.
- `.env` files are local dev overrides only — never commit them.

## Testing conventions

- Integration tests (`pnpm test:integration`) hit a real local database — do not mock the DB layer.
- Unit tests (`*.spec.ts`) live co-located with the file they test.
- Files excluded from coverage (don't add tests): `*.dto.ts`, `*.model.ts`, `*.module.ts`, `main.ts`, `bootstrap.ts`, `tracing.ts`, config files, migration scripts, seed scripts.

## SonarCloud quality gates

- **Cognitive complexity ≤ 15** per function. Extract named helpers rather than nesting.
- **No new duplication** (CPD gate). Table-driven dispatch or extracted helpers fix both issues.
- Sonar exclusions are set in `sonar-project.properties` — don't suppress findings inline unless unavoidable.

## Architecture rules

- **Bounded contexts**: each service owns its own database tables. Never query another service's DB directly; cross-service data flows through GraphQL Federation.
- **Federation changes**: any subgraph schema change must be validated at the API Gateway (`apps/backend/src/api`).
- **License**: AGPL-3.0 + dual commercial. No GPL dependencies.

## Frontend

- Next.js App Router, React 19, TailwindCSS 4, Apollo Client 4
- i18next (English/Spanish) — all user-facing strings via `react-i18next`
- WCAG 2.2 AA required for all UI — run `pnpm test:a11y` before marking UI work done
- Deployed to Cloudflare Pages via `@opennextjs/cloudflare`

## Pre-push workflow (mandatory)

Before running any `git push`, always:
1. Run `/op-review` — fix any blocking findings before proceeding
2. Run `/security-review` — fix any security issues before proceeding
3. Only push after both pass cleanly

Use `git push --no-verify` only for explicit WIP/draft pushes to your own branch where no review was intended.

## MVP target

**July 4, 2026** is the public MVP launch deadline. Prioritize citizen-facing flows over internal tooling or polish. Flag anything that risks this date.

## CI

GitHub Actions (`.github/workflows/`):
- `ci.yml` — lint, test, build, integration tests (runs on every PR to `develop`)
- `validate-main-pr.yml` — pre-merge gate for `main`
- `release.yml` / `publish.yml` — triggered on merge to `main`

PRs must pass lint and build. Do not merge with failing checks.

## Docs

- `docs/architecture/system-overview.md` — full architecture with diagrams
- `docs/architecture/provider-pattern.md` — pluggable provider design
- `docs/architecture/ai-ml-pipeline.md` — RAG and embeddings
- `docs/guides/getting-started.md` — first-time setup
- `docs/guides/auth-security.md` — auth flows and HMAC details
- `docs/guides/region-provider.md` — adding a civic region
