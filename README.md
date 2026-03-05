# OPUSPOPULI

A full-stack platform with 100% open-source AI/ML capabilities for semantic search and RAG (Retrieval-Augmented Generation).

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

1. **100% Open Source** - All components use OSS licenses (Apache 2.0, MIT, etc.)
2. **Self-Hosted First** - Complete control over data and infrastructure
3. **Pluggable Architecture** - Swap implementations without code changes

## Prerequisites

- **Node.js** 20+ and pnpm
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
| **LLM** | Ollama (Mistral, Llama 3.1) | Any Ollama model |

### Infrastructure
- [Docker](https://www.docker.com) - Containerization
- [Docker Compose](https://docs.docker.com/compose/) - Local orchestration
- [Terraform](https://www.terraform.io) - Cloudflare infrastructure as code
- [Kubernetes](https://kubernetes.io) - Production orchestration

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
- ✅ **Multi-Model Support** - Switch between Falcon, Llama, Mistral, etc.
- ✅ **Pluggable Providers** - Swap databases and AI models via configuration
- ✅ **GraphQL Federation** - Unified API across microservices
- ✅ **Audit Logging** - Comprehensive logging with PII masking and retention policies
- ✅ **Observability** - Prometheus metrics, Loki logging, Grafana dashboards
- ✅ **Distributed Caching** - Redis for caching and rate limiting
- ✅ **Internationalization** - English and Spanish with react-i18next
- ✅ **Civic Data Integration** - Declarative region plugins for propositions, meetings, and representatives
- ✅ **AI-Powered Scraping** - Schema-on-read pipeline with structural manifests and self-healing
- ✅ **Petition Scanning** - Mobile-friendly petition capture with OCR, geolocation, and real-time activity feed
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
