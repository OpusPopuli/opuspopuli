# Mac Studio Bootstrap — From Unboxing to Live

A single-pass runbook to take a brand-new Mac Studio from sealed box to a fully running Opus Populi node serving production traffic. Aimed at IT staff or first-time operators; assumes no prior familiarity with the codebase.

**Audience:** IT, DevOps, the founder doing it themselves at 2am.
**Scope:** Reference hardware (Mac Studio M4 Max, 128 GB) running the full stack: Ollama (native), the opuspopuli backend microservices, the prompt-service, the frontend, and the Cloudflare tunnel.
**Time estimate:** 3–5 hours end-to-end if everything goes well. 1–2 of those hours are downloads (model weights, docker image base layers).
**Out of scope:** Cloud VM deployment, Linux workstations, multi-region setups. See [`deployment.md`](deployment.md) for those.

This guide intentionally **references** the topical guides ([`docker-setup.md`](docker-setup.md), [`ollama-setup.md`](ollama-setup.md), [`secrets-management.md`](secrets-management.md), etc.) instead of duplicating them. When you hit a section that says "see X for details," go read X — this runbook only covers the orchestration.

---

## Phase 0 — Pre-arrival checklist (do BEFORE the Mac arrives)

These don't need the hardware. Do them in parallel with shipping so you're not blocked when the box lands.

- [ ] **Apple ID** for the production machine (separate from anyone's personal account; bind to the org's shared inbox).
- [ ] **GitHub access** — confirm an SSH key exists for whichever account will pull the three repos (`opuspopuli`, `prompt-service`, `opuspopuli-regions`). If using a deploy key, generate it now.
- [ ] **Cloudflare tunnel** — provision via Terraform per [`deployment.md` §7](deployment.md#7-set-up-the-edge-proxy). Capture the tunnel token; it'll go into the Mac later.
- [ ] **DNS records** for the public hostnames pointing at the Cloudflare tunnel.
- [ ] **External secrets** — Resend API key, FEC API key, any other 3rd-party tokens. Stash them in 1Password or your secrets vault — see [`secrets-management.md`](secrets-management.md).
- [ ] **Static IP / DHCP reservation** on the LAN side (Cloudflare tunnel doesn't need it but troubleshooting is much easier with a stable address).
- [ ] **Hostname** decided (e.g., `opuspopuli-prod-01`).

If any of these are missing when the hardware arrives, you'll stall mid-setup. Resolve them first.

---

## Phase 1 — Hardware unboxing and macOS first-boot (~30 min)

### 1.1 — Plug in

Connect, in this order:

1. Power
2. Ethernet (preferred) or confirm Wi-Fi credentials in advance
3. Display via HDMI or USB-C → DisplayPort
4. USB keyboard + pointer (initial setup only; can go headless after)

Apple's "monitor required for first boot" caveat is real — don't skip step 3.

### 1.2 — Setup Assistant

Walk through the macOS Setup Assistant:

- **Region/keyboard** as appropriate.
- **Network** — connect via Ethernet if available; Wi-Fi otherwise.
- **Apple ID** — sign in with the production Apple ID from Phase 0. **Do not** use a personal account.
- **Account name** — use `admin` or `opuspopuli-admin`. The username will become the home directory (`/Users/<name>`); pick something stable.
- **Skip** Touch ID, Apple Pay, Siri, Screen Time, and the analytics opt-ins for the production machine.
- **FileVault** — enable. Production data is on Supabase volumes, but your `.env` files and Cloudflare tunnel token will live on disk. Stash the recovery key in your secrets vault.
- **iCloud Drive / Photos / Mail / Contacts / Calendar** — disable all. This is a server, not a desktop.

### 1.3 — System settings to lock down

After first boot, open **System Settings**:

- **General → Software Update** — install all available updates, then enable automatic updates.
- **Displays → Sleep** — Never. The Mac is a server; sleep kills running services.
- **Energy** (under Battery on laptops; on Mac Studio it's **Energy**) — enable **"Start up automatically after a power failure"**. The `mac-studio-setup.sh` script also sets this via `pmset`, but verifying in the GUI catches edge cases on first run.
- **Screen Lock** — set to require password immediately after sleep, but since sleep is disabled, this only matters for screen-locked-while-awake.
- **Sharing**:
  - **Remote Login (SSH)** — enable. Restrict to the admin user.
  - **Screen Sharing** — enable for emergency GUI access. Restrict to admin user. Use a strong password.
  - **File Sharing** — leave off.
  - **Computer Name** — set to the hostname from Phase 0 (e.g., `opuspopuli-prod-01`). The local DNS name becomes `<hostname>.local`.
- **Users & Groups → Login Options** — disable **automatic login** (FileVault requires it disabled anyway).

### 1.4 — Verify network identity

```bash
hostname              # should match the Computer Name you set
ipconfig getifaddr en0  # current IP — verify it matches your DHCP reservation
ping -c 1 1.1.1.1     # confirm internet reachability
```

---

## Phase 2 — Developer tooling (~30 min, mostly downloads)

### 2.1 — Xcode Command Line Tools

```bash
xcode-select --install
```

A GUI dialog appears; accept and let it run. Re-running the command shows `command line tools are already installed` once it's done.

### 2.2 — Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After install finishes it prints **two lines** to add Homebrew to the PATH — actually run them. Verify:

```bash
brew --version
```

### 2.3 — Core CLI tools

```bash
brew install git gh pnpm jq
brew install --cask docker          # Docker Desktop
```

`pnpm` ships with corepack-enabled Node, so a separate Node install isn't needed for the workspace tools. If you need a freestanding Node for one-off scripts, `brew install fnm` and `fnm install --lts`.

Open Docker Desktop once from `/Applications` so it can grant kernel extensions; accept the EULA. Then set:

- **Settings → General → Start Docker Desktop when you sign in to your computer** — enable.
- **Settings → Resources → Memory** — at least 16 GB. The region service alone reserves 6 GB during finance sync.
- **Settings → Resources → Disk image size** — at least 200 GB.

Verify:

```bash
docker --version && docker compose version
```

### 2.4 — GitHub auth

```bash
gh auth login
```

Pick HTTPS + browser flow, sign in with the production GitHub account. Then test:

```bash
gh repo view OpusPopuli/opuspopuli
```

If the account uses an SSH key instead, place it at `~/.ssh/id_ed25519` and `chmod 600` it.

---

## Phase 3 — Clone the three repos (~5 min)

```bash
mkdir -p ~/Development/Opus
cd ~/Development/Opus
gh repo clone OpusPopuli/opuspopuli
gh repo clone OpusPopuli/prompt-service
gh repo clone OpusPopuli/opuspopuli-regions
```

Confirm the layout:

```bash
ls ~/Development/Opus
# expected: opuspopuli  opuspopuli-regions  prompt-service
```

The opuspopuli `docker-compose-uat.yml` and the prompt-service compose both reference each other on the `prompt-service_default` Docker network — **the directory layout matters**, don't rename them.

---

## Phase 4 — Run `mac-studio-setup.sh` (~30–60 min)

The automation script handles Ollama, Docker auto-start verification, cloudflared, and the auto-restart-on-power-failure setting.

```bash
cd ~/Development/Opus/opuspopuli
chmod +x scripts/mac-studio-setup.sh
./scripts/mac-studio-setup.sh
```

What this does (see the script source for specifics):

1. **Ollama (native macOS)** — installs and starts via launchd. Pulls the production model weights via [`scripts/setup-ollama.sh --prod`](../../scripts/setup-ollama.sh). Models are several GB each — this is the longest single step.
2. **Docker** — verifies Docker Desktop is installed and running.
3. **cloudflared** — installs and registers the tunnel as a launchd service. You'll be prompted for the tunnel token from Phase 0.
4. **Auto-restart on power failure** — `sudo pmset -a autorestart 1`.

If any sub-step fails, the script exits non-zero. Re-run after fixing — it's idempotent.

Verify when it's done:

```bash
ollama list                         # production models present
launchctl list | grep cloudflared   # tunnel daemon registered
pmset -g | grep autorestart         # autorestart       1
```

For deeper Ollama tuning (GPU layers, num_parallel), see [`ollama-setup.md`](ollama-setup.md) and [`llm-configuration.md`](llm-configuration.md).

---

## Phase 5 — Configure secrets (~15 min)

The compose stack pulls some secrets from env vars and others from Supabase Vault. See [`secrets-management.md`](secrets-management.md) for the model.

Minimum env vars to populate before bringing up the stack — drop them in `~/.opuspopuli.env` or wherever your secrets-manager workflow points to:

```bash
# External APIs
FEC_API_KEY=...                # required for federal campaign-finance sync
RESEND_API_KEY=...             # required for transactional email

# Prompt-service auth (matches docker-compose API_KEYS env)
PROMPT_SERVICE_API_KEY=dev-key-1   # OR your production key

# Optional but recommended
SUPABASE_VAULT_URL=...
SUPABASE_VAULT_SERVICE_ROLE_KEY=...
```

If you're running the UAT compose for validation, the file at [`docker-compose-uat.yml`](../../docker-compose-uat.yml) ships with safe-default test keys — **do not** use that compose file for production traffic.

For production, use [`docker-compose.yml`](../../docker-compose.yml) + the deployment-specific override per [`deployment.md` §6](deployment.md#6-configure-secrets-and-environment).

---

## Phase 6 — Bring up the prompt-service first (~10 min)

The opuspopuli backend depends on the prompt-service over the `prompt-service_default` Docker network, so this comes first.

```bash
cd ~/Development/Opus/prompt-service
docker compose up -d --build
```

Apply migrations + seed prompts:

```bash
docker compose exec <prompt-service-container-name> pnpm db:migrate deploy
docker compose exec <prompt-service-container-name> pnpm db:seed
```

(Find the container name with `docker compose ps`.)

Smoke test:

```bash
curl -s -X POST http://localhost:3210/api/render \
  -H 'authorization: Bearer dev-key-1' \
  -H 'content-type: application/json' \
  -d '{"name":"document-analysis-representative-bio","inputs":{"TEXT":"test"}}' \
  | jq '.promptText | length'
```

Expect a positive integer (the rendered prompt length). If you get a 401, the API key is wrong; 404 means the prompt isn't seeded.

---

## Phase 7 — Bring up the opuspopuli stack (~15–30 min, mostly image build)

```bash
cd ~/Development/Opus/opuspopuli
pnpm install
pnpm --filter @opuspopuli/relationaldb-provider db:generate
docker compose -f docker-compose-uat.yml up -d --build
```

(Use the production compose instead of `-uat` once you're past validation. The flow is identical.)

Watch service health:

```bash
docker compose -f docker-compose-uat.yml ps
docker compose -f docker-compose-uat.yml logs -f db-migrate region api
```

Wait until `region` and `api` show `(healthy)` — typically 60–90 s after `db-migrate` finishes.

For container-level troubleshooting see [`docker-setup.md`](docker-setup.md), [`docker-healthchecks.md`](docker-healthchecks.md), and [`container-resources.md`](container-resources.md).

---

## Phase 8 — Bring up the frontend (~5 min)

```bash
cd ~/Development/Opus/opuspopuli
docker compose -f docker-compose-frontend.yml up -d --build
```

The frontend image bakes in `next build` — first build takes 5–8 min; subsequent rebuilds with no source changes are cached.

---

## Phase 9 — Smoke test the live stack (~10 min)

### 9.1 — Health endpoints

```bash
for port in 3000 3001 3002 3003 3004 3210; do
  printf "port %s: " $port
  curl -fsS "http://localhost:$port/health" && echo
done
```

All six should return `{"status":"ok"}`.

### 9.2 — GraphQL

```bash
curl -s -X POST http://localhost:3000/api \
  -H 'content-type: application/json' \
  -H 'apollo-require-preflight: true' \
  -d '{"query":"{ regionInfo { name supportedDataTypes } }"}' | jq
```

Expect the configured region's name and at least `[PROPOSITIONS, MEETINGS, REPRESENTATIVES, CAMPAIGN_FINANCE]`.

### 9.3 — End-to-end via the frontend

In a browser:

1. Visit `https://<your-tunnel-hostname>` (or `http://<mac-hostname>.local:3300` on the LAN).
2. Sign up + verify email through Inbucket at `http://localhost:54324` (UAT) or your real SMTP (prod).
3. Add an address with full district info.
4. Visit `/region` — both your Assemblymember and your Senator should appear under "My Representatives," and the Legislative Committees card should be visible.
5. Click into a committee → all four layers (Snapshot/Members/Hearings/Deep Dive) render.

### 9.4 — Trigger an initial sync

GraphQL Playground at `http://localhost:3000/graphql` (or via curl with the auth header):

```graphql
mutation {
  syncDataType(dataType: REPRESENTATIVES) { dataType processed created updated }
}
```

Watch the region log — you should see `Legislative committee linker complete` and `Generated N/N legislative committee descriptions successfully`. See [`region-setup-and-validation-guide.md`](region-setup-and-validation-guide.md) for the full validation matrix.

---

## Phase 10 — Lock down + handoff (~30 min)

- [ ] Confirm cloudflared is reachable via the public hostname (`curl -I https://<hostname>` returns 200 from the frontend).
- [ ] Confirm SSH from a remote workstation works: `ssh admin@opuspopuli-prod-01.local`.
- [ ] Confirm screen sharing as a fallback.
- [ ] Reboot the Mac and confirm everything comes back automatically:
  - Ollama daemon
  - Docker Desktop
  - The compose stacks (Docker Desktop's autostart restarts the previously-running containers)
  - cloudflared tunnel
- [ ] Pull the FileVault recovery key into your secrets vault (you should already have it from Phase 1.3 — verify it's still there).
- [ ] Document any deviation from this runbook in `docs/site-notes/<hostname>.md` so the next operator knows what's different.
- [ ] Add the host to your monitoring (uptime checks, log aggregation) per [`observability.md`](observability.md) and [`distributed-tracing.md`](distributed-tracing.md).

---

## Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| `db-migrate` exits non-zero | Migration SQL conflict or DB unreachable | [`database-migration.md`](database-migration.md) |
| `region` keeps restarting (OOM) | Docker Desktop memory cap too low | Phase 2.3 — bump to 16 GB+ |
| `network prompt-service_default not found` | Prompt-service stack not running | Phase 6 |
| Frontend serves 404 from agenda links / stale data | Service worker cache | DevTools → Application → Service Workers → Unregister + Reload |
| Ollama responses timing out | `OLLAMA_NUM_PARALLEL` mismatch with `BIO_GENERATOR_CONCURRENCY` | [`ollama-setup.md`](ollama-setup.md), [`llm-configuration.md`](llm-configuration.md) |
| `apollo-require-preflight` request still 403s | NestJS CSRF middleware is also active | Use the in-browser fetch instead — same-origin cookies bypass both layers |
| Cloudflare tunnel reports unhealthy | Token rotated or DNS not pointing at the tunnel | [`deployment.md` §7](deployment.md#7-set-up-the-edge-proxy) |

If you hit something not in the table, the topical guides under `docs/guides/` are the next stop. After that, the architecture docs under `docs/architecture/` explain the why.
