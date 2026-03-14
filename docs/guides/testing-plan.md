# Ground-Up Testing Plan

After clearing all Docker containers, images, and volumes, use this step-by-step plan to verify everything works. Each phase builds on the previous one — don't move forward until the current phase is green.

## Phase 0: Prerequisites & Clean Slate Verification

```bash
# Confirm everything is truly clean
docker system df                    # Should show 0 for everything
docker ps -a                        # No containers
docker images                       # No images
docker volume ls                    # No volumes

# Verify core tools
node -v                             # Should be v20.x
pnpm -v                             # Should be installed
docker --version                    # Docker Desktop running
```

**Check environment files exist:**
- `/apps/backend/.env` (copy from `.env.example` if missing)
- `/apps/frontend/.env.local` (copy from `.env.example` if missing)
- Root `.env.production` only needed later for prod stack

---

## Phase 1: Ollama (Native LLM — No Docker)

Ollama runs on the host, not in Docker. Test this first since multiple services depend on it.

```bash
# 1a. Install/verify Ollama
./scripts/setup-ollama.sh           # Or: brew install ollama

# 1b. Start Ollama
ollama serve                        # Run in a separate terminal

# 1c. Verify API is responding
curl http://localhost:11434/api/tags # Should return JSON with models list

# 1d. Pull dev model
ollama pull qwen3.5:9b

# 1e. Smoke test the model (think: false disables Qwen 3.5 reasoning mode for fast responses)
time curl http://localhost:11434/api/chat -d '{
  "model": "qwen3.5:9b",
  "messages": [{"role": "user", "content": "Say hello in one sentence"}],
  "stream": false,
  "think": false,
  "options": {"num_predict": 50}
}'
# Should return a JSON response with generated text in ~2-5 seconds
# NOTE: Without "think": false, Qwen 3.5 generates hidden reasoning tokens
# which can make simple requests take 30-60 seconds
```

**Pass criteria:** Ollama API responds on `:11434`, model generates text.

---

## Phase 2: Install, Build & Unit Tests (No Docker Required)

These steps only need Node.js/pnpm — no Docker services required.

```bash
# All commands run from repo root: /opuspopuli

# 2a. Install dependencies
pnpm install

# 2b. Generate Prisma client
pnpm --filter @opuspopuli/relationaldb-provider db:generate

# 2c. Build all packages
pnpm -r build

# 2d. Run unit tests across the monorepo
pnpm -r test
# All tests should pass

# 2e. Run frontend-specific tests
pnpm --filter frontend test

# 2f. Lint check
pnpm -r lint
```

**Pass criteria:** Clean build, all unit tests pass, no lint errors.

---

## Phase 3: Core Infrastructure (Docker Compose)

Bring up the base development stack — databases, auth, caching, email.

```bash
# 3a. Start the dev infrastructure
docker compose up -d

# 3b. Watch containers come up (wait for all to be healthy)
docker compose ps                   # Check STATUS column for "healthy"
```

### 3c. PostgreSQL (Supabase DB)

```bash
# Connect to database
docker exec -it opuspopuli-supabase-db psql -U supabase_admin -d postgres --pset pager=off -c "SELECT version();"

# Verify extensions
docker exec -it opuspopuli-supabase-db psql -U supabase_admin -d postgres --pset pager=off -c "SELECT extname FROM pg_extension;"
# Should include: vector, postgis, pgcrypto, pgjwt, uuid-ossp
```

### 3d. Redis

```bash
docker exec -it opuspopuli-redis redis-cli ping
# Should return: PONG

docker exec -it opuspopuli-redis redis-cli info server | head -5
```

### 3e. Supabase Auth (GoTrue)

```bash
# Auth is not exposed to the host — test from inside the container
docker exec opuspopuli-supabase-auth wget -qO- http://localhost:9999/health
# Should return: {"version":"...","name":"GoTrue","description":"..."}
```

### 3f. Supabase Kong (API Gateway)

```bash
curl -s http://localhost:8000/
# Should respond (may be 401 without key, that's OK — it's alive)
# NOTE: Kong needs ~512MB RAM; if it times out, check `docker stats` for OOM
```

### 3g. Supabase Studio

```bash
# Open in browser: http://localhost:3100
# Should show Supabase admin dashboard
```

### 3h. Inbucket (Email Testing)

```bash
# Open in browser: http://localhost:54324
# Should show email inbox UI
```

**Pass criteria:** All containers show "healthy" in `docker compose ps`. Each service responds.

---

## Phase 4: Backend Microservices (Docker)

Requires Ollama (Phase 1) and Docker infrastructure (Phase 3).
The UAT compose file builds all backend services, runs migrations automatically,
and connects to the infrastructure from Phase 3.

```bash
# All commands run from repo root: /opuspopuli

# 4a. Build and start all backend services in Docker
# This includes: db-migrate, users(:3001), documents(:3002),
# knowledge(:3003), region(:3004), api gateway(:3000)
docker compose -f docker-compose-uat.yml up -d --build

# 4b. Watch containers come up (wait for all to be healthy)
docker compose -f docker-compose-uat.yml ps
# db-migrate should show "Exited (0)" — it runs once then stops
# All other services should show "healthy"

# 4c. Test health endpoints
curl http://localhost:3001/health     # Users service
curl http://localhost:3002/health     # Documents service
curl http://localhost:3003/health     # Knowledge service
curl http://localhost:3004/health     # Region service
curl http://localhost:3000/health     # API Gateway

# 4d. Test GraphQL endpoint (CSRF double-submit cookie pattern)
# First, GET the GraphQL endpoint to receive a CSRF cookie (returns 400, that's OK)
curl -s -c /tmp/csrf-cookies http://localhost:3000/api > /dev/null
CSRF_TOKEN=$(grep csrf-token /tmp/csrf-cookies | awk '{print $NF}')

# Then POST with the token in both cookie and header
curl http://localhost:3000/api \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -b "csrf-token=$CSRF_TOKEN" \
  -d '{"query":"{ __typename }"}'
# Should return: {"data":{"__typename":"Query"}}

# 4e. Test GraphQL Federation (all subgraphs composed)
curl -s http://localhost:3000/api \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -b "csrf-token=$CSRF_TOKEN" \
  -d '{"query":"{ __schema { types { name } } }"}' | python3 -m json.tool | head -20
# Should list types from all subgraphs: User, PropositionModel, SearchResult, RegionInfoModel, etc.
```

**Pass criteria:** All 5 health endpoints return OK. GraphQL responds.

---

## Phase 5: AI/ML Pipeline Verification

With Ollama running (Phase 1) and Knowledge service up (Phase 4):

```bash
# 5a. Verify LLM and embeddings initialization from knowledge service logs
docker logs opuspopuli-uat-knowledge 2>&1 | grep -i "ollama\|llm\|xenova\|embedding\|knowledge"
# Should show:
#   - XenovaEmbeddingProvider initialized with Xenova/all-MiniLM-L6-v2 (384d)
#   - OllamaLLMProvider initialized: qwen3.5:9b at http://host.docker.internal:11434
#   - KnowledgeService initialized with vector DB: PgVector, LLM: Ollama/qwen3.5:9b

# 5b. Verify region service LLM connectivity (used for structural analysis)
docker logs opuspopuli-uat-region 2>&1 | grep -i "ollama\|llm"
# Should show OllamaLLMProvider initialized
```

**Pass criteria:** Both knowledge and region services show successful Ollama and embeddings init.

---

## Phase 6: Frontend

```bash
# 6a. Start frontend dev server (from repo root)
pnpm --filter frontend dev
# Should start on http://localhost:3200

# 6b. Open in browser: http://localhost:3200
# Verify:
#   - Page loads without console errors
#   - GraphQL connection works (check Network tab for /graphql calls)
#   - Auth UI renders (login/register page)

# 6c. Test auth flow with Inbucket
#   - Register a test user with magic link
#   - Check http://localhost:54324 for the magic link email
#   - Click the link to verify auth works end-to-end
```

**Pass criteria:** Frontend loads, connects to backend, auth flow works.

---

## Phase 7: Observability Stack

```bash
# 7a. Verify Prometheus
# Open: http://localhost:9090
# Go to Status > Targets — all scrape targets should be "UP"

# 7b. Verify Grafana
# Open: http://localhost:3101
# Login: admin / admin
# Check that data sources (Prometheus, Loki) are connected
# Check pre-provisioned dashboards show data

# 7c. Verify Loki + Promtail
# In Grafana, go to Explore > select Loki data source
# Query: {container=~".+"} — should show container logs
```

**Pass criteria:** Prometheus targets UP, Grafana dashboards showing data, Loki returning logs.

---

## Phase 8: Integration Tests (Docker)

This is the full automated validation — runs everything in Docker.

```bash
# 8a. Stop any locally running services first
# Ctrl+C on backend services and frontend

# 8b. Run dockerized integration tests
./scripts/test-integration-docker.sh
# This will:
#   - Build all service images
#   - Start infrastructure + services
#   - Run migrations
#   - Execute integration test suite
#   - Clean up containers

# Watch for: all tests passing, clean exit code 0
```

**Pass criteria:** Integration test script exits with code 0, all tests pass.

---

## Phase 9: E2E Tests (Optional but Recommended)

```bash
# 9a. Start the E2E stack
docker compose -f docker-compose-e2e.yml up -d

# 9b. Wait for all services to be healthy
docker compose -f docker-compose-e2e.yml ps

# 9c. Start frontend pointing at E2E backend (port 4000)
pnpm --filter frontend dev

# 9d. Run Playwright tests
pnpm --filter frontend e2e
```

**Pass criteria:** Playwright tests pass, including accessibility checks.

---

## Quick Reference: Port Map

| Service | Port |
|---------|------|
| Ollama | 11434 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Supabase Auth | 9999 (internal only) |
| Supabase Kong | 8000 |
| Supabase Studio | 3100 |
| Inbucket (email) | 54324 |
| Users Service | 3001 |
| Documents Service | 3002 |
| Knowledge Service | 3003 |
| Region Service | 3004 |
| API Gateway | 3000 |
| Frontend | 3200 |
| Prometheus | 9090 |
| Grafana | 3101 |
| Loki | 3102 |

---

## MacBook Pro M4 Pro Notes

- Qwen 3.5:9b is the right model for dev — the 35b model is for the Mac Studio
- Ollama will use the M4 Pro's GPU cores via Metal — expect ~2-5s responses with `think: false`
- Qwen 3.5 has a "thinking" mode (on by default) that generates hidden reasoning tokens — disable it with `think: false` for structured extraction tasks; enable it for complex analysis tasks
- Docker Desktop on Apple Silicon runs natively — no Rosetta overhead for the containers
- Keep an eye on memory if running everything simultaneously; you can skip the observability stack (Prometheus/Grafana/Loki) during early phases to save ~1-2GB RAM
