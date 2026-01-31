# QCKSTRT Documentation

Welcome to the QCKSTRT documentation. This directory contains all technical documentation for the platform.

## Documentation Structure

### 📐 Architecture Documentation (`architecture/`)
As-built documentation describing how the system is designed and implemented.

- [**System Overview**](architecture/system-overview.md) - High-level architecture and design principles
- [**Provider Pattern**](architecture/provider-pattern.md) - Pluggable provider architecture
- [**Data Layer**](architecture/data-layer.md) - Database, vector storage, and user profile data architecture
- [**AI/ML Pipeline**](architecture/ai-ml-pipeline.md) - Embeddings, RAG, and LLM architecture
- [**Frontend Architecture**](architecture/frontend-architecture.md) - React/Next.js frontend design

### 📚 How-To Guides (`guides/`)
Practical guides for common tasks and workflows.

- [**Getting Started**](guides/getting-started.md) - Quick start guide for development
- [**Supabase Setup**](guides/supabase-setup.md) - Configure Supabase Auth, Storage, and Vault
- [**Docker Setup**](guides/docker-setup.md) - Running services with Docker
- [**LLM Configuration**](guides/llm-configuration.md) - Configuring and switching LLM models
- [**RAG Implementation**](guides/rag-implementation.md) - Using the RAG system (backend)
- [**RAG Demo Guide**](guides/frontend-rag-demo.md) - Using the RAG demo (frontend)
- [**Frontend Testing**](guides/frontend-testing.md) - Testing the frontend application
- [**Backend Testing**](guides/backend-testing.md) - Unit and integration testing for backend services
- [**Database Migration**](guides/database-migration.md) - Migrating between database providers
- [**Audit Logging**](guides/audit-logging.md) - Comprehensive audit logging for compliance and security
- [**Email Integration**](guides/email-integration.md) - Transactional email with Resend
- [**Region Provider**](guides/region-provider.md) - Creating custom region providers for civic data
- [**Observability**](guides/observability.md) - Prometheus metrics and Loki logging

## Quick Links

### For Developers
- [Getting Started Guide](guides/getting-started.md)
- [System Overview](architecture/system-overview.md)
- [Docker Setup](guides/docker-setup.md)

### For Frontend Developers
- [Frontend Architecture](architecture/frontend-architecture.md) - Includes i18n and WCAG 2.2 AA accessibility
- [RAG Demo Guide](guides/frontend-rag-demo.md)
- [Frontend Testing](guides/frontend-testing.md)

### For Backend Developers
- [System Overview](architecture/system-overview.md)
- [Backend Testing](guides/backend-testing.md) - Unit and integration tests
- [Audit Logging](guides/audit-logging.md)

### For DevOps/Infrastructure
- [Provider Pattern](architecture/provider-pattern.md)
- [Data Layer Architecture](architecture/data-layer.md)
- [Database Migration](guides/database-migration.md)
- [Audit Logging](guides/audit-logging.md)
- [Observability](guides/observability.md) - Prometheus, Loki, Grafana

### For AI/ML Engineers
- [AI/ML Pipeline](architecture/ai-ml-pipeline.md)
- [LLM Configuration](guides/llm-configuration.md)
- [RAG Implementation](guides/rag-implementation.md)

## Core Principles

This platform is built on three core principles:

1. **100% Open Source** - All components use OSS licenses (Apache 2.0, MIT, etc.)
2. **Self-Hosted** - Complete control over data and infrastructure
3. **Pluggable Architecture** - Swap implementations without code changes

## Technology Stack

| Layer | Provider |
|-------|----------|
| **Embeddings** | Xenova (in-process) |
| **Vector DB** | pgvector (PostgreSQL) |
| **Relational DB** | PostgreSQL (via Supabase) |
| **Auth** | Supabase Auth (Passkeys, Magic Links, Password) |
| **Storage** | Supabase Storage (avatars, documents) |
| **Secrets** | Supabase Vault |
| **LLM** | Ollama (Falcon 7B) |
| **Email** | Resend (transactional email) |
| **Caching** | Redis (distributed cache, rate limiting) |
| **Metrics** | Prometheus + Grafana |
| **Logging** | Loki + Promtail |
| **i18n** | react-i18next (English, Spanish) |
| **Accessibility** | WCAG 2.2 Level AA compliant |
| **Profile** | Civic/demographic fields, completion tracking |

## Platform Packages

The `packages/` directory contains reusable, publishable npm packages (`@qckstrt/*`) that implement the pluggable provider architecture:

| Package | Purpose |
|---------|---------|
| `@qckstrt/common` | Shared types and interfaces |
| `@qckstrt/llm-provider` | Ollama LLM integration |
| `@qckstrt/embeddings-provider` | Xenova/Ollama embeddings |
| `@qckstrt/vectordb-provider` | pgvector (PostgreSQL) |
| `@qckstrt/relationaldb-provider` | PostgreSQL (via Supabase) |
| `@qckstrt/extraction-provider` | Text extraction from URLs |
| `@qckstrt/storage-provider` | Supabase Storage |
| `@qckstrt/auth-provider` | Supabase Auth (Passkeys, Magic Links, Password) |
| `@qckstrt/secrets-provider` | Supabase Vault |
| `@qckstrt/email-provider` | Resend transactional email |
| `@qckstrt/region-provider` | Civic data integration (propositions, meetings, representatives) |

See [Provider Pattern](architecture/provider-pattern.md) and [Region Provider Guide](guides/region-provider.md) for implementation details.

## Commonwealth Labs Network

QCKSTRT is the foundation for the Commonwealth Labs Network. See the root-level documentation:

- [**Network Overview**](../NETWORK.md) - Learn about the network and how to join
- [**Network Terms**](../NETWORK-TERMS.md) - Terms of service for network members
- [**Commercial Licensing**](../LICENSE-COMMERCIAL.md) - Options for commercial use

## Support

For issues or questions:
- Check the relevant documentation section above
- Review architecture docs for design decisions
- Consult how-to guides for implementation details
