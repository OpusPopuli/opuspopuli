# Deployment Architecture

## Overview

Opus Populi is designed as a **network of independently operated nodes**. Each region operator deploys and controls their own infrastructure. There is no central server, no shared compute, and no shared database between nodes. The only shared element is the upstream codebase.

This architecture is possible because every external dependency sits behind a pluggable provider interface (`ISecretsProvider`, `IStorageProvider`, `ILLMProvider`, etc.). Deploying Opus Populi is a configuration exercise, not a code change. See [Provider Pattern](provider-pattern.md) for the full interface catalog.

## Design Principles

### Deploy Anywhere

All services run in Docker containers. If it runs Docker, it runs Opus Populi. The reference implementation uses an on-premise server, but operators can deploy to any cloud provider, dedicated server, or other hardware.

### On-Premise as Default

The reference implementation assumes an on-premise server with sufficient resources for local LLM inference (64+ GB unified/system memory, 8+ CPU cores, GPU acceleration). Running Mistral 7B and Llama 3.1 models locally requires substantial hardware — a Mac Studio M4 Max with 128 GB unified memory is the reference machine. This is intentional: lowest cost, maximum data sovereignty, zero cloud dependency. Cloud VM deployments are a supported alternative, not the default.

### Outbound-Only Networking

The compute node never exposes inbound ports to the public internet. An edge proxy (Cloudflare Tunnel, ngrok, Tailscale Funnel, or a reverse proxy behind a firewall) handles public ingress. This dramatically simplifies on-premise network security: no port forwarding, no dynamic DNS, no exposed services.

For cloud VM deployments with a static IP, operators can use a standard reverse proxy (Nginx + Let's Encrypt, Caddy) instead of a tunnel.

### Region Independence

Each deployment is a fully self-contained node. No shared compute, no shared database, no shared secrets between nodes. A region operator in Texas has no dependency on the operator in California.

## Deployment Topology

### Abstract Topology

```
              PUBLIC INTERNET
                    |
          +-----------------------+
          |    Edge Proxy Layer   |     SSL termination, DDoS, CDN, routing
          +-----------------------+
                    |
          +-----------------------+     Docker Compose stack:
          |    Compute Node       |       API Gateway, microservices,
          |                       |       Redis, observability
          +-------+-------+------+
                  |       |
          +-------+    +--+-------------+
          |            |                |
   +------+------+  +-+------------+  ++-------------+
   | User-Facing  |  | AI/Scratch   |  | LLM Endpoint |
   | Database     |  | Database     |  | (Inference)  |
   +--------------+  +--------------+  +--------------+
```

The **Frontend** (Next.js) can be deployed to the edge proxy layer (e.g., Cloudflare Workers), self-hosted on the compute node, or deployed to any static hosting provider.

### Component Requirements

| Component | Role | Requirements | Reference | Alternatives |
|-----------|------|--------------|-----------|--------------|
| **Compute Node** | Docker Compose stack: API gateway, 4 microservices, Redis, observability | Docker host, 64+ GB RAM, 8+ cores, GPU, stable network | Mac Studio M4 Max (128 GB) or equivalent Linux workstation | GPU cloud VM (Lambda, RunPod), or basic VPS if using cloud LLM API |
| **Edge Proxy** | Public ingress, TLS termination, DDoS protection, CDN | Routes HTTPS to the compute node | Cloudflare Tunnel (free) | Nginx + Let's Encrypt, Caddy, Tailscale Funnel, ngrok |
| **User-Facing Database** | Users, auth, documents, knowledge base, file storage | Managed PostgreSQL + pgvector, auth service, object storage | Supabase Cloud | Self-hosted Supabase, any PostgreSQL + auth stack |
| **AI/Scratch Database** | Structural manifests, pipeline state, prompt templates | PostgreSQL + pgvector, low-latency to LLM | Runs in Docker on the compute node (always local) | N/A (always colocated with compute) |
| **LLM Endpoint** | Inference for structural analysis, RAG, content evaluation | Ollama-compatible API, GPU required for production inference (Mistral 7B, Llama 3.1) | Ollama native (macOS Metal, Linux CUDA) | Claude API, OpenAI API, vLLM, Ollama in Docker (CPU, development only) |
| **Frontend** | User-facing web application (Next.js) | Static hosting or edge runtime | Cloudflare Workers | Vercel, Netlify, Docker container (self-hosted) |

## Dual-Database Strategy

The platform splits data across two databases to optimize for cost, latency, and availability:

```
+-------------------------------------------+
|          Compute Node (Docker)            |
|                                           |
|  Users Service ----+                      |
|  Documents Service-+---> Supabase Cloud   |
|  Knowledge Service-+    (user-facing)     |
|  API Gateway ------+                      |
|                                           |
|  Region Service ---+                      |
|  Knowledge Service-+---> Local PostgreSQL |
|  Scraping Pipeline-+    (AI scratch)      |
|  Prompt Client ----+                      |
+-------------------------------------------+
```

**Supabase Cloud** (user-facing):
- Users, authentication, sessions
- Documents, file storage
- Knowledge base, embeddings
- Region public data (propositions, meetings, representatives)
- Managed backups, high availability, automatic scaling

**Local PostgreSQL** (AI scratch):
- Schema-on-read structural manifests
- Scraping pipeline state
- Intermediate processing data
- Prompt templates
- Zero latency to the LLM inference engine
- No need for cloud availability; this is internal compute data

Each service connects to the appropriate database via its `DATABASE_URL` environment variable in `docker-compose-prod.yml`. The `prompt-client` package reads from whichever database its host service points to.

## Networking Model

### Tunnel Architecture (On-Premise)

```
                            +-------------------+
On-Premise Network          | Cloudflare Edge   |
+----------------+         |                   |
| Compute Node   |         | api.domain.org    |
|                |  =====> | (routes to tunnel)|
| cloudflared  --+-outbound| (TLS termination) |
| (tunnel daemon)|  only   | (DDoS protection) |
+----------------+         +-------------------+
  No inbound ports                  |
  No port forwarding          PUBLIC INTERNET
  No dynamic DNS                    |
                              End users connect
                              to Cloudflare,
                              never to your IP
```

The tunnel daemon (`cloudflared`) runs as a Docker container on the compute node. It initiates an outbound connection to the Cloudflare edge and keeps it alive. Cloudflare routes incoming requests through this tunnel. The compute node's IP address is never exposed.

### Reverse Proxy Architecture (Cloud VM)

For operators deploying to a cloud VM with a static IP, the tunnel layer is optional. A standard reverse proxy handles TLS and routing:

```
INTERNET --> Nginx/Caddy (port 443, TLS) --> localhost:8080 (API Gateway)
```

## Multi-Environment Strategy

| Environment | Compute | Database | Edge | Frontend | Cost |
|-------------|---------|----------|------|----------|------|
| **Dev** | `docker-compose.yml` (fully local) | Local Supabase (Docker) | None | `next dev` (localhost) | $0 |
| **UAT** | `docker-compose-uat.yml` + Tunnel | Supabase Cloud (free tier) + local PG | Cloudflare Tunnel | Workers preview | ~$0 |
| **Prod** | `docker-compose-prod.yml` + Tunnel | Supabase Cloud (Pro) + local PG | Tunnel + Workers | Workers (custom domain) | ~$100-150 |

The Terraform infrastructure (`infra/cloudflare/`) uses workspaces for state isolation. Each environment gets its own `tfvars` file with feature toggles:

```bash
terraform workspace select prod
terraform apply -var-file=environments/prod.tfvars
```

## Security Model

| Layer | Control | Details |
|-------|---------|---------|
| **Edge** | DDoS protection | Provided by the edge proxy (Cloudflare free tier, or WAF rules on Nginx) |
| **Edge** | CDN + caching | Reduces traffic reaching the compute node |
| **Transport** | TLS 1.3 | Edge proxy handles SSL termination |
| **Transport** | Tunnel encryption | Encrypted outbound-only connection (no inbound ports on local network) |
| **Network** | Zero inbound ports | Compute node initiates all connections outbound (on-premise only) |
| **Application** | HMAC inter-service auth | `HmacSignerService` authenticates service-to-service calls |
| **Application** | JWT + CSRF + rate limiting | Existing middleware stack |
| **Application** | GraphQL depth limiting | Prevents query complexity attacks |
| **Data** | Encryption at rest | FileVault (macOS), LUKS (Linux), or cloud provider encryption |
| **Secrets** | Pluggable provider | `SECRETS_PROVIDER=env` reads from `.env.production`; alternatives: AWS Secrets Manager, Supabase Vault |

## Failure Modes and Resilience

| Failure | Impact | Recovery |
|---------|--------|----------|
| **Internet outage** (on-premise) | API unreachable; frontend still serves from edge | Wait for ISP; or failover to cloud compute |
| **Power outage** (on-premise) | All services down; UPS provides buffer | OS auto-restart + `restart: unless-stopped` on all containers |
| **Hardware failure** | API outage | Spin up on a cloud VM using the same Docker Compose + `.env.production` |
| **Tunnel flap** | Intermittent errors for a few seconds | Tunnel daemon auto-reconnects; no action needed |
| **IP change (DHCP)** | Brief blip during reconnect | Tunnel is endpoint-agnostic; reconnects automatically |
| **Cloud VM restart** (cloud deploy) | Services down during restart | `restart: unless-stopped` + cloud provider auto-restart |

Cloud VM deployments avoid most on-premise failure modes (power, ISP) but introduce cloud provider dependency.

## Scaling Considerations

Scaling is intentionally simple. Start with the reference deployment and scale when real traffic data demands it.

- **Vertical**: Bigger machine, more RAM for larger LLM models (Llama 3.1 70B needs 64+ GB unified/system memory)
- **Edge caching**: Cache API responses at the edge for common queries (ballot data, meeting transcripts). Dramatically reduces compute load
- **Database scaling**: Upgrade Supabase plan for more connections/compute during peak
- **LLM cloud burst**: Swap Ollama for Claude API or OpenAI during high-traffic periods. The `ILLMProvider` abstraction makes this a config change
- **Horizontal** (future): Multiple compute nodes behind federated edge routing. Not needed until a single node is saturated

## Cost Model

| Deployment Profile | Compute | Edge | Database | LLM | Monthly Total |
|-------------------|---------|------|----------|-----|---------------|
| **On-premise** (reference) | $0 (owned hardware) + ~$100 ISP + ~$15 electricity | Cloudflare free | Supabase free/$25 | Ollama (free) | **~$100-150** |
| **Cloud VM (basic)** | ~$30-60 (8+ GB VPS) | Let's Encrypt (free) | Supabase free/$25 | Cloud LLM API (usage-based) | **~$50-100 + API costs** |
| **Cloud VM (GPU)** | ~$150-400 (GPU instance) | Let's Encrypt (free) | Supabase $25 | Ollama native (free) | **~$200-500** |
| **Fully self-hosted** | $0 (owned) + ~$15 electricity | Cloudflare free | Self-hosted Supabase (free) | Ollama (free) | **~$15-30** |

The platform software is free and open source (AGPL-3.0). These are infrastructure costs only.

## How Regions Relate to Deployment

A "region" in Opus Populi is a jurisdiction (California, Texas, New York, etc.). Each region operator deploys **one node** with their region plugin configured. Region plugins are declarative JSON configuration; they do not affect deployment topology.

```
                         +-- california.json (declarative config)
Region Plugin Config --> +-- federal.json   (always loaded)
                         +-- texas.json     (another operator's node)
```

A single node runs one local region plugin + the always-on federal plugin. The region plugin declares data sources (URLs, APIs, bulk downloads), and the AI-powered scraping pipeline handles extraction. No code changes are needed to add or switch regions.

See [Region Provider Guide](../guides/region-provider.md) and [Region Setup and Validation](../guides/region-setup-and-validation-guide.md) for details.

## Related Documentation

- [System Overview](system-overview.md) — Application architecture and microservices
- [Provider Pattern](provider-pattern.md) — Pluggable provider interfaces
- [Data Layer](data-layer.md) — Database architecture details
- [Deployment Guide](../guides/deployment.md) — Step-by-step reference implementation
- [Network Overview](../../NETWORK.md) — Joining the Opus Populi network
