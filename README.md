# OPUSPOPULI

A civic platform that reads primary sources — ballot measures, meeting minutes,
representative records, campaign finance — and explains them in plain language,
**with every assertion traceable to the passage it came from.**

The AI is entirely open-source and self-hosted. So is the accountability: what
the platform cannot show evidence for, it says so about.

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/rodneygagnon/opuspopuli.git
cd opuspopuli
pnpm install

# Start infrastructure
docker-compose up -d

# Pull LLM model
./scripts/setup-ollama.sh

# Start application (from project root)
pnpm dev
```

**See [Getting Started Guide](docs/guides/getting-started.md) for detailed setup instructions.**

## Evidence, and what we can currently show

Every AI-generated claim is a row, joined to the citation it rests on, and
every citation has been **checked** — the verdict is the only way a piece of
evidence acquires a state, so an unchecked assertion cannot be laundered into
a table called `evidence`.

That makes one question answerable that used to be impossible: *show every
published assertion that lacks primary evidence*. It is a query, and a watched
metric (`claims_unevidenced`), not a claim in a README.

**Measured against the current corpus — 1,497 claims:**

| Family | verified | lacking verified evidence | |
|---|---|---|---|
| Ballot measures | 59 | **469** of 528 | 88.8% |
| Meeting minutes | 105 | **113** of 218 | 51.8% |
| Representative bios | 0 | **751** of 751 | 100% |

**89% of what the platform asserts cannot currently be traced to a supporting
passage.** That number is published here for the same reason it is on a
dashboard: a platform that measures its own evidence and then omits the result
is choosing which of the two to believe.

Two things it does *not* mean. Representative bios are 100% by construction,
not by failure — they cite structured fields rather than text spans, so
nothing in that family can reach `verified` against a passage, and the
distinction between *"no citation was offered"* and *"a citation failed a
check"* is kept rather than collapsed. And the ballot-measure figure is the
honest result of a contract being replaced: citations used to be character
offsets the model asserted, which measured 2–11% accurate because counting
characters is arithmetic and no model tested does it. They are now **verbatim
quotes the model supplies and code locates** — exact, and failing closed when a
quote cannot be found.

### How a claim is accountable

- **Which prompt produced it** — every output carries the prompt's content hash
  and version, and the prompt text itself is published, so a reader can go read
  the instruction that produced what they are looking at.
- **Which model produced it** — name plus weight digest, not just a tag.
- **Which text version it cites** — a claim is bound by hash to the source text
  it was generated against, so an analysis cannot outlive the text under it
  without that being detectable.
- **What was asserted when** — regenerating supersedes rather than overwrites,
  so *"what did this platform say about this measure last month"* has an answer.

### Models

Inference is self-hosted on [Ollama](https://ollama.com) and splits by job:
`olmo-3.1:32b-instruct` for analysis and synthesis, where the task is copying a
passage exactly and declining when the source does not support a claim, and
`olmo-3:7b-instruct` for ingestion, where it is structured extraction across far
more documents. Both are open-weight, and OLMo publishes its training data as
well as its weights.

## 📚 Documentation

All documentation is located in the [`docs/`](docs/) directory:

### For Developers
- **[Getting Started](docs/guides/getting-started.md)** - Set up your development environment (5 minutes)
- **[System Overview](docs/architecture/system-overview.md)** - High-level architecture
- **[RAG Implementation](docs/guides/rag-implementation.md)** - Using the AI/ML pipeline

### For DevOps
- **[Docker Setup](docs/guides/docker-setup.md)** - Infrastructure services
- **[Observability](docs/guides/observability.md)** - Metrics, logging, and dashboards
- **[Database Migration](docs/guides/database-migration.md)** - Migrating between providers
- **[Provider Pattern](docs/architecture/provider-pattern.md)** - Pluggable architecture
- **[Audit Logging](docs/guides/audit-logging.md)** - Compliance and security logging

### For AI/ML Engineers
- **[AI/ML Pipeline](docs/architecture/ai-ml-pipeline.md)** - Embeddings, RAG, and LLM
- **[LLM Configuration](docs/guides/llm-configuration.md)** - Configuring and switching models
- **[Data Layer](docs/architecture/data-layer.md)** - Vector and relational databases

## Core Principles

1. **Evidence or Silence** - An assertion the platform cannot trace to a source
   passage is marked as such rather than presented as equivalent to one it can
2. **Above Reproach, Outcome-Indifferent** - The test of a design is whether it
   would survive being read by someone who dislikes its conclusion
3. **100% Open Source** - All components use OSS licenses (Apache 2.0, MIT, etc.)
4. **Self-Hosted First** - Complete control over data and infrastructure
5. **Pluggable Architecture** - Swap implementations without code changes

## Prerequisites

- **Node.js** 24+ and pnpm
- **Docker** and Docker Compose
- **Git**
- **Cloudflare Account** (for production deployment)

## Technology Stack

### Frontend
- [React](https://react.dev) 19 + [Next.js](https://nextjs.org) 16 - Modern web UI with App Router
- [TailwindCSS](https://tailwindcss.com) 4 - Utility-first CSS
- [Apollo Client](https://www.apollographql.com) - GraphQL state management

### Backend (Microservices)
- [NestJS](https://nestjs.com) - Node.js framework
- [GraphQL Federation](https://www.apollographql.com/docs/federation/) - Unified API gateway
- [Prisma](https://www.prisma.io) - Database ORM

### AI/ML Stack (100% OSS)

| Component | Default Provider | Alternative Options |
|-----------|-----------------|---------------------|
| **Embeddings** | Xenova (in-process) | Ollama |
| **Vector DB** | pgvector (PostgreSQL) | Custom implementations |
| **Relational DB** | PostgreSQL (via Supabase) | Any PostgreSQL |
| **LLM** | Ollama (Qwen 3.5) | Any Ollama model |

### Infrastructure
- [Docker](https://www.docker.com) - Containerization
- [Docker Compose](https://docs.docker.com/compose/) - Local dev / test orchestration
- [Terraform](https://www.terraform.io) - Cloudflare infrastructure as code (in the [node template repo](https://github.com/OpusPopuli/opuspopuli-node))

### Production deployment

Each Opus Populi region is operated independently. Production deployment lives in [**OpusPopuli/opuspopuli-node**](https://github.com/OpusPopuli/opuspopuli-node) — a GitHub Template repo containing the per-region deployment kit (Terraform for Cloudflare, `docker-compose-prod.yml`, Mac Studio bootstrap, backup pipeline, observability configs). Each region operator uses the template to create their own repo (e.g. `OpusPopuli/opuspopuli-node-ca`), configures their Cloudflare account and Mac Studio, and runs the bootstrap.

This monorepo is the **source of record**: code, builds, signed images at `ghcr.io/opuspopuli/*`, and npm packages at `npm.pkg.github.com/opuspopuli`. No operator secrets ever live here. See [`docs/guides/deployment.md`](docs/guides/deployment.md) for the platform/operator split.

### Platform Services
- [Supabase](https://supabase.com) - Auth (with Passkeys/Magic Links), Storage, and Vault (self-hosted or cloud)
- [PostgreSQL](https://www.postgresql.org) + [pgvector](https://github.com/pgvector/pgvector) - Database and vector storage
- [Ollama](https://ollama.ai) - Local LLM inference
- [Redis](https://redis.io) - Distributed caching and rate limiting

### Observability
- [Prometheus](https://prometheus.io) - Metrics collection
- [Loki](https://grafana.com/oss/loki/) - Log aggregation
- [Grafana](https://grafana.com) - Visualization and dashboards

## Project Structure

```
opuspopuli/
├── packages/                 # 📦 Reusable platform packages (@opuspopuli/*)
│   ├── common/               # Shared types and interfaces
│   ├── llm-provider/         # LLM integration (Ollama)
│   ├── embeddings-provider/  # Embeddings (Xenova, Ollama)
│   ├── vectordb-provider/    # Vector DB (pgvector)
│   ├── relationaldb-provider/# Relational DB (PostgreSQL)
│   ├── extraction-provider/  # Text extraction
│   ├── storage-provider/     # File storage (Supabase Storage, Cloudflare R2)
│   ├── auth-provider/        # Authentication (Supabase Auth)
│   ├── secrets-provider/     # Secrets management (Supabase Vault)
│   ├── email-provider/       # Transactional email (Resend)
│   ├── logging-provider/     # Audit logging
│   ├── ocr-provider/         # OCR functionality
│   ├── scraping-pipeline/   # AI-powered web scraping (schema-on-read)
│   ├── region-provider/      # Civic data integration (declarative plugins)
│   └── prompt-client/        # AI prompt template client (circuit breaker, HMAC)
├── apps/
│   ├── backend/              # NestJS microservices
│   │   └── src/
│   │       ├── api/           # GraphQL Gateway (port 3000)
│   │       └── apps/         # Services (Users, Documents, Knowledge, Region)
│   └── frontend/             # React + Next.js application (port 3200)
├── docs/                     # 📚 All documentation
│   ├── architecture/         # As-built architecture documentation
│   └── guides/               # How-to guides
├── infra/                    # Terraform Cloudflare infrastructure
├── scripts/                  # Utility scripts
└── docker-compose.yml        # Local development services
```

### Platform Packages

The `packages/` directory contains reusable workspace packages that provide pluggable provider implementations:

| Package | Purpose | Tests |
|---------|---------|-------|
| `@opuspopuli/common` | Shared types, interfaces, and HTTP connection pooling | - |
| `@opuspopuli/llm-provider` | Ollama LLM integration | 16 |
| `@opuspopuli/embeddings-provider` | Xenova/Ollama embeddings | 24 |
| `@opuspopuli/vectordb-provider` | pgvector (PostgreSQL) | 15 |
| `@opuspopuli/relationaldb-provider` | PostgreSQL | 7 |
| `@opuspopuli/extraction-provider` | Text extraction (URLs, PDFs) with caching & rate limiting | 116 |
| `@opuspopuli/storage-provider` | Supabase Storage, Cloudflare R2 | 41 |
| `@opuspopuli/auth-provider` | Supabase Auth (Passkeys, Magic Links, Password) | 29 |
| `@opuspopuli/secrets-provider` | Supabase Vault | 10 |
| `@opuspopuli/email-provider` | Resend transactional email | - |
| `@opuspopuli/logging-provider` | Audit logging | - |
| `@opuspopuli/ocr-provider` | OCR functionality | - |
| `@opuspopuli/scraping-pipeline` | AI-powered schema-on-read web scraping with structural manifests | - |
| `@opuspopuli/region-provider` | Civic data integration (declarative plugins, propositions, meetings, representatives) | - |
| `@opuspopuli/regions` | Declarative region config files ([separate repo](https://github.com/OpusPopuli/opuspopuli-regions)) | - |
| `@opuspopuli/prompt-client` | AI prompt template client with circuit breaker, HMAC auth, and caching | - |

## Development

### All Services (from project root)
```bash
pnpm dev                 # Start all services in parallel (backend + frontend)
```

### Backend
```bash
cd apps/backend
pnpm start               # All microservices concurrently (with watch mode)
pnpm start:api           # API Gateway only (port 3000)
pnpm start:users         # Users service only (port 3001)
pnpm start:documents     # Documents service only (port 3002)
pnpm start:knowledge     # Knowledge service only (port 3003)
pnpm start:region        # Region service only (port 3004)
pnpm build               # Production build
pnpm test                # Run tests
```

### Frontend
```bash
cd apps/frontend
pnpm dev                 # Dev server on port 3200
pnpm build               # Production build
pnpm test                # Run tests
```

### Infrastructure Services
```bash
docker-compose up -d     # Start all services
docker-compose down      # Stop all services
docker-compose logs -f   # View logs
```

## Features

- ✅ **Passwordless Authentication** - Passkeys (WebAuthn/FIDO2) and Magic Links
- ✅ **Profile Management** - Avatar upload, civic/demographic fields, completion tracking
- ✅ **RAG (Retrieval-Augmented Generation)** - Ask questions about your documents
- ✅ **Semantic Search** - Find relevant information using vector similarity
- ✅ **Document Indexing** - Automatic chunking and embedding generation
- ✅ **Multi-Model Support** - Switch between Qwen 3.5, Mistral, Gemma, etc.
- ✅ **Pluggable Providers** - Swap databases and AI models via configuration
- ✅ **GraphQL Federation** - Unified API across microservices
- ✅ **Audit Logging** - Comprehensive logging with PII masking and retention policies
- ✅ **Observability** - Prometheus metrics, Loki logging, Grafana dashboards
- ✅ **Distributed Caching** - Redis for caching and rate limiting
- ✅ **Internationalization** - English and Spanish with react-i18next
- ✅ **Civic Data Integration** - Declarative region plugins for propositions, meetings, and representatives
- ✅ **AI-Powered Scraping** - Schema-on-read pipeline with structural manifests and self-healing
- ✅ **Petition Scanning** - Mobile-friendly petition capture with OCR, geolocation, and real-time activity feed
- ✅ **Evidence Graph** - Claims and their citations as queryable rows; every citation verified, and "assertions lacking primary evidence" is a metric
- ✅ **Cited Analysis** - Claims quote their source verbatim; code locates the quote and derives the offsets, so a citation that cannot be found is dropped rather than guessed
- ✅ **Output Provenance** - Prompt hash and version, model name and weight digest, and the source-text version, recorded on every AI output
- ✅ **Temporal Validity** - Regeneration supersedes rather than overwrites, so past assertions stay answerable
- ✅ **Transparency Pages** - AI system card, commitments, and prompt charter
- ✅ **Campaign Finance** - Committees, contributions, expenditures, and independent expenditures
- ✅ **Accessibility** - WCAG 2.2 Level AA compliant
- ✅ **100% Self-Hosted** - Complete data control and privacy

## License

GNU Affero General Public License v3.0 (AGPL-3.0) - See [LICENSE](LICENSE) file for details.

For commercial licensing options, see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).

## Opus Populi Network

Opus Populi is the foundation for the Opus Populi Network - a collaborative ecosystem of civic technology deployments serving different jurisdictions.

- **[Network Overview](NETWORK.md)** - Learn about the network and how to join
- **[Network Terms](NETWORK-TERMS.md)** - Terms of service for network members
- **[Region Provider Guide](docs/guides/region-provider.md)** - Add civic data for your jurisdiction via declarative plugins

## Support

- 📖 Documentation: [docs/README.md](docs/README.md)
- 🐛 Issues: [GitHub Issues](https://github.com/rodneygagnon/opuspopuli/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/rodneygagnon/opuspopuli/discussions)
