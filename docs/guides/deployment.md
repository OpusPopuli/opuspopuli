# Deployment Guide

A step-by-step guide for deploying an Opus Populi node. This guide uses the **reference implementation** (on-premise server + Cloudflare Tunnel) as the default but includes adaptation notes for cloud VMs and alternative edge proxies.

**Audience:** Region operators, DevOps engineers, and anyone deploying a production Opus Populi instance.

**Time estimate:** 2-4 hours for first-time setup (excluding DNS propagation).

**Prerequisites:** Read [Deployment Architecture](../architecture/deployment.md) first to understand the topology and component requirements.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Choose Your Deployment Profile](#2-choose-your-deployment-profile)
3. [Prepare the Compute Node](#3-prepare-the-compute-node)
4. [Set Up the LLM Engine](#4-set-up-the-llm-engine)
5. [Configure the User-Facing Database](#5-configure-the-user-facing-database)
6. [Configure Secrets and Environment](#6-configure-secrets-and-environment)
7. [Set Up the Edge Proxy](#7-set-up-the-edge-proxy)
8. [Deploy the Application Stack](#8-deploy-the-application-stack)
9. [Deploy the Frontend](#9-deploy-the-frontend)
10. [Verification](#10-verification)
11. [Operations](#11-operations)
12. [Adapting for Cloud VMs](#12-adapting-for-cloud-vms)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

### Hardware Requirements

| Profile | RAM | CPU | Storage | GPU | Example Hardware |
|---------|-----|-----|---------|-----|------------------|
| Minimum | 64 GB | 8+ cores | 100 GB SSD | Required (Metal or CUDA) | Mac Mini M4 Pro (64 GB), Linux workstation w/ NVIDIA GPU |
| Recommended | 128 GB | 12+ cores | 500 GB SSD | Unified memory or 24+ GB VRAM | Mac Studio M4 Max (128 GB), Linux workstation w/ RTX 4090 |
| Reference | 128 GB | Apple M4 Max (16 cores) | 1 TB SSD | Unified memory (Metal) | Mac Studio M4 Max |

> **Why 64 GB minimum?** Mistral 7B requires ~8 GB VRAM and Llama 3.1 models require significantly more. The system also needs headroom for Docker services, PostgreSQL, Redis, and the observability stack. Running LLM inference alongside the full application stack on less than 64 GB will result in memory pressure and degraded performance.
>
> **No GPU?** If you cannot provide local GPU resources, use a cloud LLM API (Claude, OpenAI) via the `ILLMProvider` abstraction instead of Ollama. This allows running the compute node on more modest hardware (16+ GB, 4+ cores) but introduces API costs and external dependency.

### Software Requirements

| Software | Version | Purpose |
|----------|---------|---------|
| Docker Desktop (or Docker Engine) | Latest | Container runtime |
| Node.js | 20+ | Build tools |
| pnpm | Latest | Package manager (`npm install -g pnpm`) |
| Git | Latest | Source control |
| Terraform | 1.5+ | Infrastructure as code (Cloudflare reference) |

### Accounts Required (Reference Implementation)

| Service | Tier | Purpose |
|---------|------|---------|
| Cloudflare | Free | Edge proxy, DNS, tunnel |
| Supabase | Free or Pro | User-facing database + auth + storage |
| Domain registrar | Any | Your node's public domain (e.g., `yourdomain.org`) |

> **Cloud VM adaptation:** If deploying to a cloud VM with a static IP, you can skip Cloudflare and use Nginx + Let's Encrypt instead. See [Adapting for Cloud VMs](#12-adapting-for-cloud-vms).

### Network Requirements (On-Premise Only)

- Stable broadband (25+ Mbps upload recommended)
- No port forwarding required (tunnel is outbound-only)
- Static IP not required (tunnel is endpoint-agnostic)

---

## 2. Choose Your Deployment Profile

| Profile | Compute | Edge | Database | LLM | Monthly Cost |
|---------|---------|------|----------|-----|--------------|
| **On-premise** (reference) | Mac Studio M4 Max (128 GB) or equivalent | Cloudflare Tunnel | Supabase Cloud | Ollama (native) | ~$100-150 |
| **Cloud VM (basic)** | VPS (8+ GB) + cloud LLM API | Nginx + Let's Encrypt | Supabase Cloud | Claude/OpenAI API | ~$50-100 + API costs |
| **Cloud VM (GPU)** | GPU VM | Nginx + Let's Encrypt | Supabase Cloud | Ollama (native) | ~$200-500 |
| **Fully self-hosted** | Local machine | Cloudflare/Nginx | Self-hosted Supabase | Ollama (native) | ~$15-30 |

This guide follows the **On-Premise** profile. Differences for other profiles are noted in callout boxes.

---

## 3. Prepare the Compute Node

### 3.1 Clone the Repository

```bash
git clone https://github.com/opuspopuli/opuspopuli.git
cd opuspopuli
pnpm install
```

### 3.2 macOS Setup (Reference)

If using a Mac as your compute node:

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Docker Desktop
# Download from https://www.docker.com/products/docker-desktop/
# After installing:
#   1. Open Docker Desktop > Settings > General
#   2. Enable "Start Docker Desktop when you sign in to your computer"
#   3. Allocate at least 32 GB memory (Settings > Resources)
```

Configure auto-restart for power failure recovery:
- System Settings > General > Startup & Shutdown > "Start up automatically after a power failure"

Recommended: UPS (e.g., APC Back-UPS Pro 1500VA) for 15+ min runtime covering the compute node + router/modem.

> **Linux adaptation:** Install Docker Engine via your distribution's package manager. Enable the Docker service to start on boot: `sudo systemctl enable docker`.

> **Cloud VM adaptation:** Use your cloud provider's startup script or user-data to install Docker. Most cloud providers offer Docker-ready images.

### 3.3 Verify Docker

```bash
docker --version
docker compose version
```

---

## 4. Set Up the LLM Engine

### 4.1 Install Ollama (Native - Reference)

Native installation provides GPU acceleration (Metal on macOS, CUDA on Linux). Docker on macOS runs in a Linux VM without GPU access.

**macOS:**
```bash
brew install ollama
```

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 4.2 Pull Models

```bash
ollama pull mistral            # 7B - default for structural analysis
ollama pull llama3.1:70b       # 70B - requires 64+ GB unified/system memory
```

### 4.3 Verify

```bash
ollama list
curl http://localhost:11434/api/tags
```

Ollama auto-starts as a background service on port 11434. Docker containers access it via `http://host.docker.internal:11434`.

> **Docker adaptation:** If GPU access is not available or not needed, Ollama can run inside Docker. The development `docker-compose.yml` already includes an Ollama container. For production, add it to `docker-compose-prod.yml` and set `LLM_URL=http://ollama:11434`.

> **Cloud LLM adaptation:** To use Claude API or OpenAI instead of local Ollama, configure the `ILLMProvider` via environment variables. See [LLM Configuration Guide](llm-configuration.md).

---

## 5. Configure the User-Facing Database

### 5.1 Create a Supabase Project

1. Sign up at [supabase.com](https://supabase.com)
2. Create a new project
3. Note the following from Project Settings > API:
   - **Project URL** (`SUPABASE_URL`)
   - **Anon Key** (`SUPABASE_ANON_KEY`)
   - **Service Role Key** (`SUPABASE_SERVICE_ROLE_KEY`)

### 5.2 Auth and Storage

Supabase Cloud includes Auth (GoTrue) and Storage out of the box. Configure email templates, redirect URLs, and storage buckets via the Supabase dashboard.

See [Supabase Setup Guide](supabase-setup.md) for detailed configuration.

> **Self-hosted adaptation:** Run the full Supabase stack in Docker. The development `docker-compose.yml` includes all Supabase services. Use it as a starting point for your production Supabase setup.

---

## 6. Configure Secrets and Environment

### 6.1 Create Production Environment File

```bash
cp .env.production.example .env.production
```

### 6.2 Required Variables

| Variable | Description | How to Get |
|----------|-------------|------------|
| `TUNNEL_TOKEN` | Cloudflare tunnel auth token | `terraform output -raw tunnel_token` (see Step 7) |
| `SUPABASE_URL` | Supabase Cloud project URL | Supabase dashboard > Project Settings > API |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Same location |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Same location |
| `LOCAL_DB_PASSWORD` | Local PostgreSQL password | Generate: `openssl rand -hex 16` |
| `JWT_SECRET` | JWT signing secret | Generate: `openssl rand -hex 32` |
| `AUTH_JWT_SECRET` | Auth JWT signing secret | Generate: `openssl rand -hex 32` |
| `GATEWAY_HMAC_SECRET` | Inter-service HMAC secret | Generate: `openssl rand -hex 32` |
| `API_KEYS` | API key config | `'{"api-gateway":"<same-as-GATEWAY_HMAC_SECRET>"}'` |
| `RESEND_API_KEY` | Resend email API key | [resend.com](https://resend.com) dashboard |
| `LLM_MODEL` | Default LLM model | `mistral` (default) |
| `GRAFANA_PASSWORD` | Grafana admin password | Choose a secure password |

### 6.3 Secrets Provider

The production stack uses `SECRETS_PROVIDER=env` (reads from `.env.production`). This is already configured in `docker-compose-prod.yml`.

See [Secrets Management Guide](secrets-management.md) for alternative providers (AWS Secrets Manager, Supabase Vault).

---

## 7. Set Up the Edge Proxy

### 7.1 Cloudflare Setup (Reference)

#### Add Domain to Cloudflare

1. Sign up at [cloudflare.com](https://cloudflare.com) (free plan)
2. Add your domain
3. Update nameservers at your domain registrar to Cloudflare's nameservers
4. Wait for DNS propagation (usually < 1 hour)

#### Provision Infrastructure with Terraform

```bash
cd infra/cloudflare
cp environments/prod.tfvars.example environments/prod.tfvars
# Edit prod.tfvars with your Cloudflare account ID, zone ID, and API token

terraform init
terraform workspace new prod
terraform workspace select prod
terraform apply -var-file=environments/prod.tfvars
```

This creates:
- A Cloudflare Tunnel for API traffic
- DNS CNAME record (`api.yourdomain.org` -> tunnel)
- R2 storage buckets (for documents, transcripts, scraped data)

#### Retrieve the Tunnel Token

```bash
terraform output -raw tunnel_token
```

Add this to your `.env.production` as `TUNNEL_TOKEN`.

> **Nginx adaptation:** Instead of Cloudflare, install Nginx + Certbot on your cloud VM:
> ```bash
> sudo apt install nginx certbot python3-certbot-nginx
> sudo certbot --nginx -d api.yourdomain.org
> ```
> Configure the reverse proxy to forward to `localhost:8080`. See [Adapting for Cloud VMs](#12-adapting-for-cloud-vms) for the full Nginx config.

---

## 8. Deploy the Application Stack

### 8.1 Start Production Docker Compose

```bash
docker compose -f docker-compose-prod.yml up -d --build
```

This starts:

| Container | Service | Port |
|-----------|---------|------|
| `opuspopuli-prod-cloudflared` | Cloudflare Tunnel daemon | (outbound only) |
| `opuspopuli-prod-db` | Local PostgreSQL (AI scratch data) | 5432 (internal) |
| `opuspopuli-prod-redis` | Redis cache | 6379 (internal) |
| `opuspopuli-prod-db-migrate` | Database migrations (init, then exits) | - |
| `opuspopuli-prod-users` | Users microservice | 8080 (internal) |
| `opuspopuli-prod-documents` | Documents microservice | 8080 (internal) |
| `opuspopuli-prod-knowledge` | Knowledge microservice | 8080 (internal) |
| `opuspopuli-prod-region` | Region microservice | 8080 (internal) |
| `opuspopuli-prod-api` | API Gateway (Apollo Federation) | 8080 (exposed) |
| `opuspopuli-prod-prometheus` | Metrics collection | 9090 (internal) |
| `opuspopuli-prod-loki` | Log aggregation | 3100 (internal) |
| `opuspopuli-prod-promtail` | Log shipping | (internal) |
| `opuspopuli-prod-grafana` | Dashboards | 3101 (localhost only) |

### 8.2 Verify Containers

```bash
docker compose -f docker-compose-prod.yml ps
```

All services should show `Up` or `Up (healthy)`. The `db-migrate` container will show `Exited (0)` after completing migrations.

### 8.3 Check API Health

```bash
curl http://localhost:8080/health
```

Expected: `200 OK` with JSON health status.

### 8.4 Check Tunnel (Reference)

```bash
docker logs opuspopuli-prod-cloudflared
```

Look for `Connection registered` messages confirming the tunnel is active.

---

## 9. Deploy the Frontend

### 9.1 Cloudflare Workers (Reference)

```bash
cd apps/frontend
pnpm cf:deploy
```

This builds the Next.js frontend via `@opennextjs/cloudflare` and deploys it to Cloudflare Workers.

Set the `NEXT_PUBLIC_GRAPHQL_URL` environment variable in the Cloudflare dashboard or `wrangler.toml` to point to your API endpoint (e.g., `https://api.yourdomain.org/graphql`).

> **Self-hosted adaptation:** Build the frontend as a Docker container and serve it behind your reverse proxy:
> ```bash
> docker build -t opuspopuli-frontend -f apps/frontend/Dockerfile .
> docker run -d -p 3000:3000 --name opuspopuli-frontend opuspopuli-frontend
> ```
> Configure your Nginx/Caddy to proxy `app.yourdomain.org` to `localhost:3000`.

---

## 10. Verification

### 10.1 API Health (Through Edge)

```bash
curl https://api.yourdomain.org/health
```

Expected: `200 OK` (request flows through Cloudflare -> tunnel -> API Gateway).

### 10.2 GraphQL Endpoint

```bash
curl -X POST https://api.yourdomain.org/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'
```

### 10.3 Frontend

Visit `https://app.yourdomain.org` (or your configured frontend domain).

### 10.4 LLM Connectivity

```bash
# From the host
curl http://localhost:11434/api/tags

# From inside a container
docker exec opuspopuli-prod-knowledge \
  node -e "require('http').get('http://host.docker.internal:11434/api/tags', r => { r.on('data', d => process.stdout.write(d)); r.on('end', () => console.log()); })"
```

### 10.5 Database Connectivity

```bash
# Local PostgreSQL
docker exec opuspopuli-prod-db pg_isready -U postgres

# Supabase Cloud (verify from API container)
docker exec opuspopuli-prod-api \
  node -e "const http = require('http'); http.get(process.env.SUPABASE_URL + '/rest/v1/', { headers: { apikey: process.env.SUPABASE_ANON_KEY } }, r => { console.log('Status:', r.statusCode); process.exit(r.statusCode === 200 ? 0 : 1); })"
```

### 10.6 Full Smoke Test

1. User signup via frontend
2. Document upload
3. Trigger region data sync (via GraphQL Playground or `syncRegionData` mutation)
4. Verify region data displays (propositions, meetings, representatives)
5. RAG query test

See [Region Setup and Validation Guide](region-setup-and-validation-guide.md) for detailed data validation.

---

## 11. Operations

### 11.1 Updating the Application

```bash
cd opuspopuli
git pull origin main
pnpm install
docker compose -f docker-compose-prod.yml up -d --build
```

For the frontend (if using Cloudflare Workers):
```bash
cd apps/frontend
pnpm cf:deploy
```

### 11.2 Viewing Logs

```bash
# All services
docker compose -f docker-compose-prod.yml logs -f

# Specific service
docker compose -f docker-compose-prod.yml logs -f api
docker compose -f docker-compose-prod.yml logs -f region
```

### 11.3 Monitoring with Grafana

Access Grafana at `http://localhost:3101` (bound to localhost only for security).

Default credentials: `admin` / value of `GRAFANA_PASSWORD` from `.env.production`.

See [Observability Guide](observability.md) for dashboard setup and alerting.

### 11.4 Backup and Restore

**Supabase Cloud:** Automatic daily backups (managed by Supabase).

**Local PostgreSQL:**
```bash
# Backup
docker exec opuspopuli-prod-db pg_dump -U postgres opuspopuli > backup_$(date +%Y%m%d).sql

# Restore
docker exec -i opuspopuli-prod-db psql -U postgres opuspopuli < backup_20260218.sql
```

Recommended: set up a cron job for daily local DB backups.

### 11.5 Recovery After Power Failure (On-Premise)

With proper configuration, recovery is automatic:
1. macOS auto-restart brings the machine back
2. Docker Desktop auto-start brings Docker back
3. `restart: unless-stopped` brings all containers back
4. Ollama launchd agent restarts automatically
5. Cloudflare Tunnel reconnects automatically

No manual intervention required.

---

## 12. Adapting for Cloud VMs

### 12.1 Key Differences

| Aspect | On-Premise (Reference) | Cloud VM |
|--------|------------------------|----------|
| Edge proxy | Cloudflare Tunnel (required, outbound-only) | Nginx/Caddy (standard reverse proxy) or Tunnel (optional) |
| LLM | Ollama native (GPU access via Metal/CUDA) | Ollama native on GPU VM, or cloud LLM API (Claude/OpenAI) |
| `LLM_URL` | `http://host.docker.internal:11434` | `http://ollama:11434` (Docker network) or API endpoint |
| Resilience | UPS + auto-restart | Cloud provider SLA + auto-restart policies |
| Cost model | ISP + electricity | VM hourly rate |
| Tunnel token | Required in `.env.production` | Not needed if using Nginx directly |

### 12.2 Nginx Reverse Proxy Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.org;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.org/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 12.3 Adding Ollama to Docker Compose

If running Ollama in Docker (no native GPU access), add to `docker-compose-prod.yml`:

```yaml
  ollama:
    image: ollama/ollama:latest
    container_name: opuspopuli-prod-ollama
    volumes:
      - ollama-data:/root/.ollama
    networks:
      - opuspopuli-prod
    restart: unless-stopped
```

And change `LLM_URL` in the backend env to `http://ollama:11434`.

### 12.4 Removing the Tunnel Container

If using Nginx instead of Cloudflare Tunnel, remove the `cloudflared` service from `docker-compose-prod.yml` and remove `TUNNEL_TOKEN` from `.env.production`.

### 12.5 Cloud Provider Quick Notes

| Provider | Recommended Plan | Notes |
|----------|-----------------|-------|
| Hetzner | CCX33 (8 vCPU, 32 GB, ~$45/mo) | Best value; GPU instances also available |
| DigitalOcean | Premium 8 GB ($56/mo) | Simple, well-documented; GPU droplets in preview |
| Lambda | GPU Cloud (A10, ~$0.75/hr) | Purpose-built for ML inference |
| RunPod | Community GPU (~$0.20/hr) | Affordable GPU compute, Docker-native |

> **Important:** If running Ollama locally on the cloud VM, you need a GPU instance. CPU-only inference is not suitable for production workloads. Alternatively, use a cloud LLM API (Claude, OpenAI) via the `ILLMProvider` abstraction and deploy to a smaller, cheaper VM.

---

## 13. Troubleshooting

### Tunnel Not Connecting

```bash
docker logs opuspopuli-prod-cloudflared
```

- Verify `TUNNEL_TOKEN` is set correctly in `.env.production`
- Check Cloudflare dashboard > Zero Trust > Tunnels for status
- Ensure outbound HTTPS (port 443) is not blocked by your network

### API Returning 502

- Check containers are running: `docker compose -f docker-compose-prod.yml ps`
- Check API health locally: `curl http://localhost:8080/health`
- Check API logs: `docker compose -f docker-compose-prod.yml logs api`
- If tunnel is connected but API is unhealthy, the issue is in the application stack

### LLM Requests Failing

- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- Check `LLM_URL` and `LLM_MODEL` in `.env.production`
- For macOS native Ollama with Docker containers: `LLM_URL=http://host.docker.internal:11434`
- For Ollama in Docker: `LLM_URL=http://ollama:11434`

### Database Connection Errors

```bash
# Local PostgreSQL
docker exec opuspopuli-prod-db pg_isready -U postgres

# Check migration status
docker logs opuspopuli-prod-db-migrate
```

- Verify `LOCAL_DB_PASSWORD` matches in `.env.production`
- Verify `SUPABASE_URL` and keys are correct for cloud database

### Containers Restarting in a Loop

```bash
docker compose -f docker-compose-prod.yml logs <service-name>
docker stats
```

- Check for out-of-memory kills (increase Docker Desktop memory allocation)
- Check for missing environment variables
- See [Container Resources Guide](container-resources.md) for resource tuning

### Region Data Not Syncing

- Verify `REGION_SYNC_ENABLED=true` in the region service environment
- Check region service logs: `docker compose -f docker-compose-prod.yml logs region`
- Verify LLM connectivity (structural analysis requires a working LLM endpoint)
- See [Region Setup and Validation Guide](region-setup-and-validation-guide.md)

---

## Related Documentation

- [Deployment Architecture](../architecture/deployment.md) — Topology, principles, and component requirements
- [Docker Setup](docker-setup.md) — Development environment Docker configuration
- [LLM Configuration](llm-configuration.md) — Model selection and provider switching
- [Secrets Management](secrets-management.md) — Secrets provider options
- [Observability](observability.md) — Prometheus, Loki, and Grafana setup
- [Region Setup and Validation](region-setup-and-validation-guide.md) — Configuring and validating region data
- [Network Overview](../../NETWORK.md) — Joining the Opus Populi network
