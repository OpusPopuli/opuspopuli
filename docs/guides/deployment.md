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

## Adding a region

1. The new region operator forks the template into their preferred org (e.g. `OpusPopuli/opuspopuli-node-<region>` for an OpusPopuli-operated region, or `<their-org>/opuspopuli-node-<region>` for an independently-operated region).
2. They follow the template's `README.md` end to end. ~5–8 focused hours from zero to public API serving.
3. Their region's traffic flows through their own Cloudflare account + their own Mac Studio. The central `OpusPopuli/opuspopuli` repo only publishes images and packages — no operator credentials, no operator state.

## Image verification

Every image at `ghcr.io/opuspopuli/*` is cosign-signed via GitHub Actions OIDC and ships with an SPDX SBOM. Operators should verify images before pulling for the first time and on each rollback. See [`container-verification.md`](container-verification.md).
