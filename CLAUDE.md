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
pnpm start:region-worker      # Region worker  :3005
pnpm test                     # Jest unit tests
pnpm test:integration         # Requires docker compose up

# Frontend (from apps/frontend/)
pnpm dev                      # Dev server    :3200
pnpm test
pnpm e2e                      # Playwright
pnpm cf:build                 # Build the Cloudflare Worker bundle locally
pnpm cf:deploy                # Break-glass deploy — NOT the normal path (see below)
```

Each `start:*` script builds before starting watch mode — don't run `nest start` directly.

## Git workflow

**Trunk-based.** `main` is the only long-lived branch; there is no `develop`.

- **Base branch**: `main`. Cut short-lived branches from `main`, PR back to `main`.
- Never push directly to `main` — a repository ruleset rejects it, with no bypass for admins.
- Branch naming: `feat/<short-description>-<issue#>`, `fix/<short-description>-<issue#>`, `chore/<short-description>`
- **Merging does not ship.** `release.yml` triggers on a `v*` tag, not on merge:
  ```bash
  git tag v1.6.0 && git push origin v1.6.0
  ```
  Use `/op-release` to prepare the changelog, notes and evidence pack before tagging.

`develop` was removed on 2026-08-12 (see `docs/plans/`). It was buying no
coordination — it existed to insulate a stable line from in-flight work, which
needs more than one committer to mean anything — while costing a second merge on
every change and a permanent lag between the two branches.

## Architecture overview

**Microservices** (NestJS, GraphQL Federation):

| Service | Port | Owns |
|---------|------|------|
| `api` | 3000 | Apollo Gateway — federated GraphQL endpoint |
| `users` | 3001 | Auth, profiles, passkeys (WebAuthn), magic links |
| `documents` | 3002 | Document storage, petition scanning, OCR, activity feed |
| `knowledge` | 3003 | RAG pipeline — embeddings, vector search, LLM inference |
| `region` | 3004 | Civic data — propositions, meetings, representatives, campaign finance |

**Workers** (`apps/backend/src/apps/workers/`): async BullMQ job processors — no GraphQL, no HTTP beyond `/health`. Each worker owns a queue and a `pipeline_jobs`-style status table.

| Worker | Port | Queue | Trigger |
|--------|------|-------|---------|
| `region-worker` | 3005 | `region-sync` | `syncRegionData` mutation, daily cron (2 AM), optional startup job |

Adding a new worker: create `src/apps/workers/<name>/`, register in `nest-cli.json`, add a `Dockerfile.<name>` following `Dockerfile.region-worker`, add to `docker-compose-prod.yml` and `docker-compose-uat.yml`.

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

## Deploying to a node (the Studio)

**Always layer BOTH compose files.** The prompt-service overlay is not optional:

```bash
ssh -t opuspopuli@opuspopuli-us-ca
security unlock-keychain ~/Library/Keychains/login.keychain-db   # SSH sessions do not auto-unlock it
cd /Volumes/OpusPopuli/Development/opuspopuli-node-us-ca
./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml pull
./bin/op-compose -f docker-compose-prod.yml -f docker-compose-prompt-service.yml up -d
```

`docker-compose-prompt-service.yml` does two things, and omitting it silently
loses both:

1. Defines the `opuspopuli-prompts` / `opuspopuli-prompts-db` containers
2. Injects `PROMPT_SERVICE_URL` into `knowledge`, `region`, `region-worker`,
   `structural-analysis-worker`, `llm-rerank-worker` and `documents`

Deploying with `-f docker-compose-prod.yml` alone starts everything, reports
healthy, and leaves those six services unable to reach prompt-service. Prompt
fetches then fall back, produce nothing, and the empty results get cached — on
2026-08-17 that blanked every relevance explanation on the platform (484 empty
cache rows against one with content) with no error anywhere. `requirePromptServiceUrl`
now throws at boot in production so this fails loudly, but layer the overlay
rather than relying on that.

Note the overlay alone is invalid — it carries partial definitions for the six
services above, so `-f docker-compose-prompt-service.yml` by itself fails with
`service "region-worker" has neither an image nor a build context`.

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
- `MCP_DATABASE_URL` (used by the Postgres MCP server in `.mcp.json`) must be a **read-only** DSN against a **local/non-prod** database — MCP query results flow to the hosted model, so never point it at production personal data.

## Testing conventions

- Integration tests (`pnpm test:integration`) hit a real local database — do not mock the DB layer.
- Unit tests (`*.spec.ts`) live co-located with the file they test.
- Files excluded from coverage (don't add tests): `*.dto.ts`, `*.model.ts`, `*.module.ts`, `main.ts`, `bootstrap.ts`, `tracing.ts`, config files, migration scripts, seed scripts.

### Integration test database isolation (#796)

**Integration tests run against a dedicated `postgres_test` database, never the dev `postgres`.** The dev `postgres` DB holds your manually-synced bills, your user account, your enabled region plugins — losing that to a routine test run cost ~30 minutes of recovery per incident before this safeguard existed.

How it works:
- `apps/backend/.env` defines `INTEGRATION_DATABASE_URL` pointing at `postgres_test`
- `apps/backend/__tests__/integration/setup.ts::bootstrapTestDatabase` runs once in `globalSetup`: creates `postgres_test` if missing (via `ensureTestDatabase()`), installs required extensions (postgis/pgvector/etc.), runs `prisma migrate deploy` against it, then swaps `process.env.DATABASE_URL` so every test worker inherits the test DB
- `docker-compose-integration.yml` services use `postgres_test` for the same reason
- `apps/backend/__tests__/integration/utils/db-cleanup.ts::cleanDatabase` calls `assertTestDatabase()` first, which **throws** if `DATABASE_URL` doesn't end in `_test` — belt-and-suspenders against accidental dev-DB wipes from future regressions

**DO NOT**:
- Remove the `assertTestDatabase()` guard
- Point `INTEGRATION_DATABASE_URL` at the `postgres` database
- Revert `docker-compose-integration.yml`'s `RELATIONAL_DB_DATABASE`/`DATABASE_URL` back to `postgres`
- Write tests that go around `cleanDatabase()` directly via `db.someTable.deleteMany()` without calling `assertTestDatabase()` first

#### Region active-plugin hot-swap — federal limitation

`updateRegionPlugin` (and the recovery mutation `refreshActiveRegion`) re-load only the **local** plugin slot. The federal plugin keeps the `stateCode` resolution it picked up at boot. So if you flip from `california` (stateCode=CA) to a different state plugin live, the federal plugin's CA-shaped config placeholders remain in memory until a service restart. In practice the federal plugin almost never needs to change after boot, so this is a documented limitation, not a bug. If you do need federal to re-resolve, restart `region` + `region-worker`.

## Logging levels

`LOG_LEVEL` sets verbosity for every service and worker. Unset, it defaults to
`info` in production and `debug` everywhere else — the behaviour before #1094.

```bash
# raise one service to debug, on the node
LOG_LEVEL=debug ./bin/op-compose -f docker-compose-prod.yml \
  -f docker-compose-prompt-service.yml up -d --force-recreate region
```

Set it on **one service at a time**. Turning debug on across all eight at once,
on a node that also runs the LLM workers, is a log-volume problem of its own.

**Lower it again when you are done.** Debug statements are the lines least
likely to have been reviewed for what they print, precisely because their
authors expect them to be invisible in production — the audit for #1094 found a
resident street address being logged from the geocoder, at `warn`, which
production was emitting already.

Log **format** stays keyed to `NODE_ENV`: production keeps structured JSON at
any level. Raising verbosity during an incident must not also change the shape
of every line the log pipeline is parsing.

An unrecognised value falls back to the default and warns at startup rather
than silently selecting nothing.

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
- Deployed to a Cloudflare **Worker** (not Pages) via `@opennextjs/cloudflare`

### Shipping the frontend

**Tag `frontend-v*`.** `deploy-frontend.yml` builds and deploys the Worker, gated on approval in
the `production` environment:

```bash
git tag frontend-v1.1.0 && git push origin frontend-v1.1.0
```

Separate from the backend's `v*` tag on purpose — a UI fix should not need a backend release, and
a backend patch should not redeploy the Worker.

`pnpm cf:deploy` still works and is **break-glass only**, for when Actions is unavailable. It
ships whatever is in your working tree, from a local `.env.production.local` that exists on one
machine, and nothing records what was deployed.

Two things about the build worth knowing before changing it:

- `NEXT_PUBLIC_*` are inlined at **build** time, so the bundle is region-specific and a rebuild is
  required to change any of them. CI supplies them from the `US_CA_*` repository variables.
- `NEXT_PUBLIC_GRAPHQL_URL` and `NEXT_PUBLIC_SITE_URL` have **localhost fallbacks in source**, so a
  build with them unset succeeds and deploys a site that talks to nothing. `check-worker-env.mjs`
  does not catch this — it only guards against non-public keys, and reads `.env` files that do not
  exist on a runner. The workflow asserts the real origin is present in the built bundle instead.

## SDLC tooling (Claude Code plugin)

The `op-*` workflow commands — `/op-review`, `/op-issue-plan`, `/op-release`, `/op-verify`, `/op-data-scan`, `/op-trace`, `/op-change-record`, `/op-validate`, and the rest — ship as the shared **[opuspopuli-sdlc](https://github.com/OpusPopuli/opuspopuli-sdlc)** Claude Code plugin. It's auto-enabled in every session (local or remote) via the committed `.claude/settings.json`; the only per-developer step is trusting the repo folder once. Repo-specific commands (`/op-migration`) live in `.claude/skills/`. The plugin's `docs/compliance-model.md` maps the lifecycle to HIPAA / SOC 2 / 21 CFR Part 11 controls.

## Pre-push workflow (mandatory)

Before running any `git push`, always:
1. Run `/op-review` (from the opuspopuli-sdlc plugin) — fix any blocking findings before proceeding
2. Run `/security-review` — fix any security issues before proceeding
3. Only push after both pass cleanly

Use `git push --no-verify` only for explicit WIP/draft pushes to your own branch where no review was intended.

## MVP target

**September 1, 2026** is the public MVP launch deadline. Prioritize citizen-facing flows over internal tooling or polish. Flag anything that risks this date.

## CI

GitHub Actions (`.github/workflows/`):
- `ci.yml` — lint, test, build, integration tests (runs on every PR to `main`)
- `release.yml` — builds, signs and publishes images. Triggered by a **`v*` tag**, not by merging
- `publish.yml` — npm package publish

PRs must pass lint and build. Do not merge with failing checks.

## Docs

- `docs/architecture/system-overview.md` — full architecture with diagrams
- `docs/architecture/provider-pattern.md` — pluggable provider design
- `docs/architecture/ai-ml-pipeline.md` — RAG and embeddings
- `docs/architecture/personalized-relevance.md` — signal taxonomy, T1/T2/T3 tiers, ranking axes, briefing design (epic #740)
- `docs/architecture/frontend-architecture.md` — Next.js App Router layout, i18n namespaces, /me/* surfaces
- `docs/guides/getting-started.md` — first-time setup
- `docs/guides/auth-security.md` — auth flows and HMAC details
- `docs/guides/region-provider.md` — adding a civic region
