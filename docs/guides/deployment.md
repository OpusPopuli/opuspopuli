# Deployment

Production deployment of an Opus Populi region happens from the **per-region deployment template repo**, not from this monorepo. This separation keeps each region operator's Cloudflare credentials, Mac Studio configuration, and Terraform state in their own repo — never centralized.

## Where to deploy from

[**OpusPopuli/opuspopuli-node**](https://github.com/OpusPopuli/opuspopuli-node) is the entry point. Each region operator:

1. Uses the template to create their own repo (e.g. `OpusPopuli/opuspopuli-node-ca`, `<their-org>/opuspopuli-node-tx`)
2. Configures region-specific values in `infra/cloudflare/environments/prod.tfvars`
3. Sets 5 GitHub Secrets in their repo (Cloudflare token, account ID, zone ID, Terraform Cloud token + org)
4. Opens a PR → `terraform plan` posts as a PR comment
5. Merges to `main` → `terraform apply` runs (creates Tunnel, DNS, R2 buckets, Pages project)
6. Bootstraps their Mac Studio with `scripts/mac-studio-setup.sh`
7. Pulls images from `ghcr.io/opuspopuli/*` and starts the stack with `docker compose -f docker-compose-prod.yml pull && up -d`

Full step-by-step is in the deployment template's [README.md](https://github.com/OpusPopuli/opuspopuli-node) and [`docs/mac-studio-bootstrap.md`](https://github.com/OpusPopuli/opuspopuli-node/blob/main/docs/mac-studio-bootstrap.md).

## What this monorepo handles

| Concern | Lives where |
|---|---|
| Source code (apps + packages) | This repo |
| Dockerfiles + image builds | This repo (CI builds, pushes to `ghcr.io/opuspopuli/*`) |
| npm package publishing | This repo (CI publishes to `npm.pkg.github.com/opuspopuli`) |
| Image signing + SBOM | `.github/workflows/release.yml` — see [`container-verification.md`](container-verification.md) |
| Production Terraform | [Template repo](https://github.com/OpusPopuli/opuspopuli-node) |
| `docker-compose-prod.yml` + bind-mount sources | [Template repo](https://github.com/OpusPopuli/opuspopuli-node) |
| Mac Studio bootstrap automation | [Template repo](https://github.com/OpusPopuli/opuspopuli-node) |
| Backup pipeline (`pg_dump → R2`) | [Template repo](https://github.com/OpusPopuli/opuspopuli-node) |
| Observability configs (Prometheus / Grafana / Loki / Tempo) | [Template repo](https://github.com/OpusPopuli/opuspopuli-node) |
| Per-region operator secrets | Operator's region repo's GitHub Secrets (never here) |
| **First-party `us-ca` frontend deploy** | **This repo** — `.github/workflows/deploy-frontend.yml` (documented exception, below) |

### The frontend deploy is an exception to the rule above

`deploy-frontend.yml` deploys the `us-ca` Cloudflare Worker from this repo, using a
`CLOUDFLARE_API_TOKEN` held in this repo's `production` environment. That is a real departure from
"never centralized," so it is written down rather than left to be discovered.

Why it is here and not in the region repo:

- Every `NEXT_PUBLIC_*` is inlined at **build** time, so a Worker bundle is specific to one
  region's API and site URLs. There is no build-once-deploy-anywhere artifact to hand an operator,
  the way `ghcr.io/opuspopuli/*` images are.
- The frontend source and the `frontend-v*` tag both live here.
- `apps/frontend/wrangler.toml` already hard-codes the node's hostname, so this repo was
  region-coupled on the frontend before the workflow existed.

### Hostnames

| | |
|---|---|
| App (canonical) | `california.opuspopuli.org` |
| App (legacy, still served) | `app-us-ca.opuspopuli.org` |
| API | `api-us-ca.opuspopuli.org` |

`app-us-ca` encoded an internal region identifier in the one URL citizens are asked to type and
share. `california` is the canonical name; the old host stays routed so existing links keep
working, and comes out of `wrangler.toml` once a Cloudflare Redirect Rule 301s it across.

This is a **hostname** rename only — the region id (`us-ca`), the plugin identifiers and every
stored row are unchanged. The API keeps its `api-us-ca` name for now: it is not user-facing, and
moving it means a Terraform `api_subdomain` change in the node repo plus a backend CORS flip.

Renaming the app host was cheap for one reason worth knowing before anyone changes it: `WEBAUTHN_RP_ID`
is `opuspopuli.org`, the **registrable domain**, so passkeys are bound to the parent and survived
the move. Had it been the full host, the rename would have silently invalidated every registered
credential. See `apps/backend/src/config/webauthn.config.ts`.

**What this does not change.** Backend images stay region-agnostic and operator-pulled. No Mac
Studio config, Terraform state, or backend credential moves here. The token is scoped to Workers
plus the `opuspopuli.org` zone, and lives in an environment secret readable only by that one job.

**What is still unsolved.** A third-party operator running their own region cannot use this
workflow — it would mean handing them our Cloudflare token, or us holding theirs. Until that is
designed, an independent operator builds and deploys their own frontend from their node repo.
That gap is tracked, and it blocks the "Adding a region" story below for anyone outside
OpusPopuli.

## Adding a region

1. The new region operator forks the template into their preferred org (e.g. `OpusPopuli/opuspopuli-node-<region>` for an OpusPopuli-operated region, or `<their-org>/opuspopuli-node-<region>` for an independently-operated region).
2. They follow the template's `README.md` end to end. ~5–8 focused hours from zero to public API serving.
3. Their region's traffic flows through their own Cloudflare account + their own Mac Studio. For an independent operator the central `OpusPopuli/opuspopuli` repo publishes only images and packages — none of their credentials, none of their state.
4. **The frontend is the open edge.** Steps 1–3 get an operator to a public API; they do not get them a deployed frontend. `deploy-frontend.yml` builds for `us-ca` specifically, because `NEXT_PUBLIC_*` values are baked in at build time, and it uses OpusPopuli's own Cloudflare token. An independent operator must build and deploy their own Worker from their node repo today. Designing a supported path for that is open work — see the exception note above.

## Image verification

Every image at `ghcr.io/opuspopuli/*` is cosign-signed via GitHub Actions OIDC and ships with an SPDX SBOM. Operators should verify images before pulling for the first time and on each rollback. See [`container-verification.md`](container-verification.md).
