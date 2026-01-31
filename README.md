# QCKSTRT

A full-stack platform with 100% open-source AI/ML capabilities for semantic search and RAG (Retrieval-Augmented Generation).

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/rodneygagnon/qckstrt.git
cd qckstrt
npm install

# Start infrastructure
docker-compose up -d

# Pull LLM model
./scripts/setup-ollama.sh

# Start application
cd apps/backend && npm run start:dev
cd apps/frontend && npm run dev
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

- **Node.js** 18+ and npm/pnpm
- **Docker** and Docker Compose
- **Git**
- **AWS Account** (for production deployment)

## Technology Stack

### Frontend
- [React](https://react.dev) + [Vite](https://vitejs.dev) - Modern web UI
- [TailwindCSS](https://tailwindcss.com) - Utility-first CSS
- [GraphQL Client](https://www.apollographql.com) - API integration

### Backend (Microservices)
- [NestJS](https://nestjs.com) - Node.js framework
- [GraphQL Federation](https://www.apollographql.com/docs/federation/) - Unified API gateway
- [TypeORM](https://typeorm.io) - Database ORM

### AI/ML Stack (100% OSS)

| Component | Default Provider | Alternative Options |
|-----------|-----------------|---------------------|
| **Embeddings** | Xenova (in-process) | Ollama |
| **Vector DB** | pgvector (PostgreSQL) | Custom implementations |
| **Relational DB** | PostgreSQL (via Supabase) | RDS PostgreSQL |
| **LLM** | Ollama (Falcon 7B) | Any Ollama model |

### Infrastructure
- [Docker](https://www.docker.com) - Containerization
- [Docker Compose](https://docs.docker.com/compose/) - Local orchestration
- [Terraform](https://www.terraform.io) - AWS infrastructure as code
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
qckstrt/
├── packages/                 # 📦 Reusable platform packages (@qckstrt/*)
│   ├── common/               # Shared types and interfaces
│   ├── llm-provider/         # LLM integration (Ollama)
│   ├── embeddings-provider/  # Embeddings (Xenova, Ollama)
│   ├── vectordb-provider/    # Vector DB (pgvector)
│   ├── relationaldb-provider/# Relational DB (PostgreSQL)
│   ├── extraction-provider/  # Text extraction
│   ├── storage-provider/     # File storage (Supabase Storage)
│   ├── auth-provider/        # Authentication (Supabase Auth)
│   └── secrets-provider/     # Secrets management (Supabase Vault)
├── apps/
│   ├── backend/              # NestJS microservices
│   │   └── src/
│   │       └── apps/         # Services (API Gateway, Users, Documents, Knowledge, Files)
│   └── frontend/             # React + Next.js application
├── docs/                     # 📚 All documentation
│   ├── architecture/         # As-built architecture documentation
│   └── guides/               # How-to guides
├── infra/                    # Terraform AWS infrastructure
├── scripts/                  # Utility scripts
└── docker-compose.yml        # Local development services
```

### Platform Packages

The `packages/` directory contains reusable, publishable npm packages that provide pluggable provider implementations:

| Package | Purpose | Tests |
|---------|---------|-------|
| `@qckstrt/common` | Shared types and interfaces | - |
| `@qckstrt/llm-provider` | Ollama LLM integration | 16 |
| `@qckstrt/embeddings-provider` | Xenova/Ollama embeddings | 24 |
| `@qckstrt/vectordb-provider` | pgvector (PostgreSQL) | 19 |
| `@qckstrt/relationaldb-provider` | PostgreSQL | 7 |
| `@qckstrt/extraction-provider` | Text extraction (URLs, PDFs) with caching & rate limiting | 116 |
| `@qckstrt/storage-provider` | Supabase Storage | 17 |
| `@qckstrt/auth-provider` | Supabase Auth (Passkeys, Magic Links, Password) | 29 |
| `@qckstrt/secrets-provider` | Supabase Vault | 10 |

## Development

### Backend
```bash
cd apps/backend
npm run start:dev        # All microservices with hot-reload
npm run start:dev -- api # API Gateway only
npm run build           # Production build
npm run test            # Run tests
```

### Frontend
```bash
cd apps/frontend
npm run dev             # Dev server with HMR
npm run build           # Production build
npm run preview         # Preview production build
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
- ✅ **Accessibility** - WCAG 2.2 Level AA compliant
- ✅ **100% Self-Hosted** - Complete data control and privacy

## License

GNU Affero General Public License v3.0 (AGPL-3.0) - See [LICENSE](LICENSE) file for details.

For commercial licensing options, see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).

## Commonwealth Labs Network

QCKSTRT is the foundation for the Commonwealth Labs Network - a collaborative ecosystem of civic technology deployments serving different jurisdictions.

- **[Network Overview](NETWORK.md)** - Learn about the network and how to join
- **[Network Terms](NETWORK-TERMS.md)** - Terms of service for network members
- **[Region Provider Guide](docs/guides/region-provider.md)** - Create a custom region provider for your jurisdiction

## Support

- 📖 Documentation: [docs/README.md](docs/README.md)
- 🐛 Issues: [GitHub Issues](https://github.com/rodneygagnon/qckstrt/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/rodneygagnon/qckstrt/discussions)
