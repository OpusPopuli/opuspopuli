# Postman — OpusPopuli Backend

`OpusPopuli.postman_collection.json` drives the backend GraphQL API through the
API Gateway. It's environment-agnostic — every request uses `{{gateway_url}}`,
so the same collection runs against local dev or a deployed node by swapping the
environment.

## Environments

| File | Target | `gateway_url` |
|------|--------|---------------|
| `OpusPopuli-UAT.postman_environment.json` | Local dev / UAT — all services on `localhost` | `http://localhost:3000` |
| `OpusPopuli-PROD.postman_environment.json` | A deployed node (e.g. us-ca Studio) | `http://opuspopuli-us-ca:8080` |

### Why PROD only has the gateway

A **node publishes exactly one API surface to the network: the gateway** (and
kong/Supabase, only so you can log in). Every microservice — users, documents,
knowledge, region, the workers — runs *inside* the node's Docker network and is
**not reachable from outside**. You talk to all of them through the federated
gateway. So the PROD environment deliberately carries only:

| Var | Purpose |
|-----|---------|
| `gateway_url` | the one API endpoint (GraphQL at `{{gateway_url}}/api`) |
| `supabase_url` + `supabase_anon_key` | log in via Supabase Auth to get the admin JWT |
| `test_email` / `test_password` | seeded admin (`admin@opuspopuli.local` / `Admin1234!`) |
| `csrf_token`, `access_token`, `sync_job_id`, `llm_rerank_job_id` | set by scripts at runtime |

> The per-service `*_url` variables and the individual **service** health-check
> requests are **local-dev only** — on a node those ports don't exist. Use
> **API Gateway - Health** on a node.

### Set `gateway_url` for your node

- **Local-only node** (Tailscale/LAN, no public tunnel): `http://<node-host>:8080`
  — e.g. `http://opuspopuli-us-ca:8080` (Tailscale) or `http://192.168.4.25:8080` (LAN).
- **Public / Cloudflare-Tunnel node**: `https://api.<your-domain>` (443, no port).

Keep the **same host** across a whole run — the `csrf-token` cookie is
host-scoped, so seeding on one host and mutating on another won't carry it.

### One secret to paste

`supabase_anon_key` must match what **kong validates against** — the value the
running gateway container actually uses. A wrong/placeholder value makes kong
return `{"message":"Unauthorized","request_id":...}` on login (before gotrue
ever checks the password). Read the authoritative value straight from the
container (this is the source of truth — the Keychain copy can drift from what's
actually running):
```bash
docker exec opuspopuli-api printenv SUPABASE_ANON_KEY
```
(The anon key is public/non-secret, but it's not committed here — the pre-push
secret scanner flags any JWT.)
Change `test_password` only if the node was bootstrapped with a custom
`SEED_ADMIN_PASSWORD`.

## Run order

1. **Health Checks → API Gateway - Seed CSRF Token (run first!)** — seeds the
   `csrf-token` cookie + `{{csrf_token}}` var (returns 200 via `{__typename}`).
   The collection pre-request script then attaches `x-csrf-token` + the cookie
   to every POST automatically.
2. **Auth → Login via Supabase Auth (run this first!)** — logs in as the admin,
   saving the JWT to `{{access_token}}` (the collection's `Bearer` auth).
3. Now any request works. To scrape:
   **Pipeline Jobs (Region Worker) → Sync — …** enqueues a `syncRegionData` job
   (saves `{{sync_job_id}}`), then **Poll Job Status** tracks it.

## Kicking off a scrape

`syncRegionData(regionId, dataTypes, depth, maxReps, maxBills)` → `RegionSyncJob!`
(admin + CSRF gated — both handled by the collection).

- `regionId`: `"california"` (state). Enable it first if reported inactive:
  **Region → Enable Region Plugin (Admin)** with `name: "california"`.
- `dataTypes`: `PROPOSITIONS · MEETINGS · REPRESENTATIVES · CAMPAIGN_FINANCE · CIVICS · BILLS`
- `depth`: `STATE · COUNTY · ALL`
- Start small (low `maxReps`/`maxBills`) to validate the pipeline before a full pull.
