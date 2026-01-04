# System Overview

## Architecture Principles

QCKSTRT is built on a modular, provider-based architecture with three core principles:

1. **100% Open Source** - All dependencies use permissive OSS licenses
2. **Self-Hosted First** - Designed for complete data control and privacy
3. **Pluggable Providers** - Swap implementations via configuration, not code

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/Vite)                    │
└─────────────────────────────────────────────────────────────┘
                            ↓ GraphQL
┌─────────────────────────────────────────────────────────────┐
│              API Gateway (GraphQL Federation)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌──────────────┬─────────────┬──────────────┐
        ↓              ↓             ↓
   ┌────────┐    ┌──────────┐  ┌──────────┐
   │ Users  │    │Documents │  │Knowledge │
   │Service │    │ Service  │  │ Service  │
   └────────┘    └──────────┘  └──────────┘
        │              │             │
        ↓              ↓             ↓
   ┌────────────────────────────────────────────────────┐
   │              Provider Layer (Pluggable)            │
   ├────────────────────────────────────────────────────┤
   │ Relational DB │ Vector DB │ Embeddings │   LLM    │
   │  (Supabase)   │ (pgvector)│  (Xenova)  │ (Ollama) │
   └────────────────────────────────────────────────────┘
```

## Microservices Architecture

### API Gateway
- **Technology**: Apollo Gateway (GraphQL Federation)
- **Port**: 3000
- **Purpose**: Unified GraphQL endpoint for frontend
- **Location**: `apps/backend/src/apps/api`

### Users Service
- **Technology**: NestJS + Apollo Federation
- **Port**: 3001
- **Purpose**: User authentication, profile management, and civic data
- **Location**: `apps/backend/src/apps/users`
- **Database**: Relational (User profiles, credentials, passkeys)
- **Authentication Methods**:
  - Passkeys (WebAuthn/FIDO2) - Primary passwordless method
  - Magic Links - Email-based passwordless login
  - Password - Legacy fallback
- **Profile Features**:
  - Avatar upload via Supabase Storage (presigned URLs)
  - Civic fields (political affiliation, voting frequency, policy priorities)
  - Demographic fields (occupation, education, income, household, homeowner status)
  - Profile completion tracking (weighted scoring up to 130%)
  - Profile visibility toggle (public/private)

### Documents Service
- **Technology**: NestJS + Apollo Federation
- **Port**: 3002
- **Purpose**: Document storage, metadata management, and file processing
- **Location**: `apps/backend/src/apps/documents`
- **Database**: Relational (Document metadata)
- **Storage**: Supabase Storage

### Knowledge Service
- **Technology**: NestJS + Apollo Federation
- **Port**: 3003
- **Purpose**: RAG (Retrieval-Augmented Generation) system
- **Location**: `apps/backend/src/apps/knowledge`
- **Components**:
  - Embeddings generation (Xenova/Ollama)
  - Vector search (pgvector on PostgreSQL)
  - LLM inference (Ollama with Falcon 7B)

## Provider Architecture

All external dependencies use the **Strategy Pattern + Dependency Injection** for maximum flexibility. Providers are implemented as reusable npm packages in the `packages/` directory.

### Platform Packages

| Package | Purpose | Provider Token |
|---------|---------|----------------|
| `@qckstrt/relationaldb-provider` | Database connections | `RELATIONAL_DB_PROVIDER` |
| `@qckstrt/vectordb-provider` | Vector storage & search | `VECTOR_DB_PROVIDER` |
| `@qckstrt/embeddings-provider` | Text embeddings | `EMBEDDINGS_PROVIDER` |
| `@qckstrt/llm-provider` | LLM inference | `LLM_PROVIDER` |
| `@qckstrt/storage-provider` | File storage (Supabase) | `STORAGE_PROVIDER` |
| `@qckstrt/auth-provider` | Authentication (Supabase) | `AUTH_PROVIDER` |
| `@qckstrt/secrets-provider` | Secrets management (Supabase Vault) | `SECRETS_PROVIDER` |
| `@qckstrt/extraction-provider` | Text extraction | `EXTRACTION_PROVIDER` |

### Relational Database Provider
**Package**: `@qckstrt/relationaldb-provider`

```typescript
interface IRelationalDBProvider {
  getName(): string;
  getType(): RelationalDBType;
  getConnectionOptions(entities): DataSourceOptions;
  isAvailable(): Promise<boolean>;
}
```

**Implementations**:
- `PostgresProvider` - Default (via Supabase)

**See**: [Data Layer Architecture](data-layer.md)

### Vector Database Provider
**Package**: `@qckstrt/vectordb-provider`

```typescript
interface IVectorDBProvider {
  initialize(): Promise<void>;
  createEmbeddings(...): Promise<boolean>;
  queryEmbeddings(...): Promise<IVectorDocument[]>;
  deleteEmbeddings...(): Promise<void>;
  getName(): string;
  getDimensions(): number;
}
```

**Implementation**:
- `PgVectorProvider` - PostgreSQL with pgvector extension (default)

**See**: [Data Layer Architecture](data-layer.md)

### Embeddings Provider
**Package**: `@qckstrt/embeddings-provider`

```typescript
interface IEmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  getDimensions(): number;
  getName(): string;
}
```

**Implementations**:
- `XenovaEmbeddingProvider` - In-process, zero-setup (default)
- `OllamaEmbeddingProvider` - Local server, GPU-accelerated

**See**: [AI/ML Pipeline](ai-ml-pipeline.md)

### LLM Provider
**Package**: `@qckstrt/llm-provider`

```typescript
interface ILLMProvider {
  getName(): string;
  getModelName(): string;
  generate(prompt, options): Promise<GenerateResult>;
  generateStream(prompt, options): AsyncGenerator<string>;
  chat(messages, options): Promise<GenerateResult>;
  isAvailable(): Promise<boolean>;
}
```

**Implementation**:
- `OllamaLLMProvider` - Self-hosted, any model (Falcon 7B default)

**See**: [AI/ML Pipeline](ai-ml-pipeline.md)

## Data Flow

### Document Indexing Flow
```
1. User uploads document → Documents Service
2. Documents Service stores metadata → Relational DB
3. Documents Service triggers indexing → Knowledge Service
4. Knowledge Service:
   a. Chunks document text
   b. Generates embeddings (Xenova)
   c. Stores vectors (pgvector)
```

### RAG Query Flow
```
1. User asks question → Knowledge Service
2. Knowledge Service:
   a. Generates query embedding (Xenova)
   b. Searches similar vectors (pgvector)
   c. Retrieves top-k document chunks
   d. Builds prompt with context
   e. Generates answer (Ollama/Falcon)
3. Returns answer to user
```

**See**: [RAG Implementation Guide](../guides/rag-implementation.md)

### Authentication Flows

**Security Architecture Overview**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser                    API Gateway                Microservices    │
│  ┌──────────┐               ┌──────────┐              ┌──────────────┐  │
│  │ Frontend │──CSRF+Cookie─▶│ Gateway  │───HMAC sig──▶│ Users/Docs   │  │
│  │(no       │  (httpOnly)   │(validates│  (gateway    │ (validates   │  │
│  │ secrets) │               │  CSRF)   │   signs)     │  HMAC)       │  │
│  └──────────┘               └──────────┘              └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Passkey Login** (Primary):
```
1. User clicks "Sign in with Passkey" → Frontend
2. Frontend requests authentication options → API Gateway → Users Service
3. Users Service generates challenge → WebAuthn Challenge DB
4. User authenticates via biometric/PIN → Browser WebAuthn API
5. Browser returns signed assertion → Frontend
6. Frontend sends assertion → API Gateway → Users Service
7. Users Service verifies signature with stored public key
8. Users Service sets httpOnly cookies (access + refresh tokens)
9. API Gateway propagates Set-Cookie headers to browser
10. Frontend stores user metadata (not tokens) for UI
```

**Magic Link Login**:
```
1. User enters email → Frontend
2. Frontend sends magic link request → API Gateway → Users Service
3. Users Service generates OTP → Supabase Auth
4. Supabase sends email with magic link → User
5. User clicks link → /auth/callback page
6. Callback verifies token → API Gateway → Users Service
7. Users Service sets httpOnly cookies (access + refresh tokens)
8. API Gateway propagates Set-Cookie headers to browser
```

**Email-First Registration**:
```
1. User enters email (no password) → /register page
2. Magic link sent to verify email → Supabase Auth
3. User clicks link → Account created → Logged in
4. httpOnly cookies set automatically
5. Prompt: "Add a passkey for faster sign-in?"
   ├── Yes → WebAuthn registration → Passkey saved
   └── Skip → Can add later in settings
```

**Subsequent Requests** (After Login):
```
1. Browser automatically sends httpOnly cookies with each request
2. Frontend reads CSRF token from non-httpOnly cookie
3. Frontend includes CSRF token in X-CSRF-Token header
4. API Gateway validates CSRF token (header matches cookie)
5. API Gateway extracts user from JWT cookie
6. API Gateway signs request with HMAC for microservices
7. Microservices validate HMAC signature
8. If cookies set by subgraph, gateway propagates to browser
```

**Logout**:
```
1. Frontend calls logout mutation
2. API Gateway forwards to Users Service
3. Users Service clears httpOnly cookies via Set-Cookie headers
4. API Gateway propagates cookie clearing to browser
5. Frontend clears local user metadata
```

## Configuration Management

### Environment-Based Configuration
All services use environment variables with sensible defaults:

```bash
# Default (Supabase OSS stack with pgvector)
RELATIONAL_DB_PROVIDER=postgres
VECTOR_DB_DIMENSIONS=384
EMBEDDINGS_PROVIDER=xenova
LLM_MODEL=falcon
AUTH_PROVIDER=supabase
STORAGE_PROVIDER=supabase
SECRETS_PROVIDER=supabase

# WebAuthn/Passkeys (required for passkey authentication)
WEBAUTHN_RP_NAME=Qckstrt
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

### Configuration Files
- `apps/backend/.env` - Local development overrides
- `apps/backend/src/config/index.ts` - Configuration loader
- `docker-compose.yml` - Service orchestration

**See**: [Getting Started Guide](../guides/getting-started.md)

## Deployment Architecture

### Development
```
Local Machine
├── Node.js (Backend services)
├── Docker Compose (docker-compose up)
│   ├── Supabase (Auth, Storage, Vault, PostgreSQL + pgvector)
│   └── Ollama (port 11434)
└── Vite Dev Server (Frontend)
```

### Production
```
AWS/Cloud Infrastructure
├── ECS/Kubernetes (Backend services)
├── RDS PostgreSQL (Relational + Vectors via pgvector)
├── EC2 GPU Instance (Ollama)
└── CloudFront + S3 (Frontend)
```

## Technology Stack Summary

| Component | Technology | Version | License |
|-----------|-----------|---------|---------|
| **Backend Framework** | NestJS | 11.x | MIT |
| **API Layer** | GraphQL (Apollo Federation) | 5.x | MIT |
| **Frontend** | React + Vite | 18.x | MIT |
| **Relational DB** | PostgreSQL (via Supabase) | 15.x | PostgreSQL |
| **Auth/Storage/Secrets** | Supabase | Latest | Apache 2.0 |
| **Vector DB** | pgvector (PostgreSQL) | Latest | PostgreSQL |
| **Embeddings** | Xenova/Transformers.js | Latest | Apache 2.0 |
| **LLM Runtime** | Ollama | Latest | MIT |
| **LLM Model** | Falcon 7B | Latest | Apache 2.0 |

## Security Considerations

### Data Privacy
- All AI/ML processing happens on self-hosted infrastructure
- No data sent to third-party APIs (OpenAI, Anthropic, etc.)
- Vector embeddings stored locally
- LLM inference runs locally

### Authentication

**Passwordless-first** authentication with three methods:
- **Passkeys (WebAuthn/FIDO2)** - Primary method using biometric/PIN
- **Magic Links** - Email-based passwordless login (like Medium)
- **Password** - Legacy fallback for compatibility

**Token Security** (Cookie-Based):
- JWT tokens stored in httpOnly cookies (protected from XSS attacks)
- CSRF protection via stateless double-submit cookie pattern
- Frontend sends CSRF token header, backend validates against cookie
- No secrets or tokens stored in localStorage or accessible to JavaScript

**Gateway-to-Microservice Security** (HMAC):
- API Gateway signs requests to microservices with HMAC-SHA256
- Microservices validate `X-HMAC-Auth` header before processing
- Prevents direct access to microservices bypassing the gateway
- Cookie propagation through federated GraphQL architecture

**Authorization**:
- User authentication via Supabase Auth (GoTrue)
- GraphQL field-level authorization via CASL
- Passkey credentials stored in PostgreSQL with counter verification

**GraphQL DoS Protection**:
- Query depth limiting (max 10 levels) prevents deeply nested queries
- Query complexity limiting (max 1000 points) prevents expensive query combinations
- Field-level complexity hints on expensive operations (LLM calls: 100, vector search: 50)
- Clear error messages with `QUERY_COMPLEXITY_EXCEEDED` code

See [Authentication Security Guide](../guides/auth-security.md) for implementation details.

### Infrastructure
- Self-hosted Supabase stack
- Encryption at rest (PostgreSQL, Supabase Storage)
- Encryption in transit (TLS/HTTPS)
- Secrets management via Supabase Vault

### Audit Trail
- Comprehensive audit logging of all GraphQL operations
- Failed login tracking for security monitoring
- PII masking protects sensitive data in logs
- Configurable retention policies for compliance
- Query audit logs for security investigations

## Monitoring & Observability

### Logging
- Structured logging via NestJS Logger
- Log levels: debug, log, warn, error
- Per-service log streams

### Audit Logging
- **Automatic capture** of all GraphQL operations via global interceptor
- **PII masking** for sensitive fields (passwords, tokens, emails)
- **Non-blocking writes** via batched queue (100 entries or 5 seconds)
- **Configurable retention** with automatic cleanup (default: 90 days)
- **IP address tracking** with proxy/load balancer support
- Stored in PostgreSQL with indexed queries by user, entity, and time

**See**: [Audit Logging Guide](../guides/audit-logging.md)

### Metrics
- Service health checks
- Database connection pooling metrics
- Vector DB query performance
- LLM inference latency

## Scalability

### Horizontal Scaling
- Stateless services can scale horizontally
- Load balancer for API Gateway
- Read replicas for PostgreSQL

### Vertical Scaling
- Ollama benefits from GPU instances
- PostgreSQL can scale vertically

### Consolidated Architecture
- pgvector consolidates relational + vector data in single PostgreSQL database
- Reduces infrastructure complexity
- ACID transactions across relational + vector data

## Future Enhancements

### Planned Providers
- **LLM**: vLLM, Text Generation Inference
- **Embeddings**: Custom fine-tuned models

### Recently Implemented
- **Profile Enhancements**: Avatar upload, civic/demographic fields, profile completion tracking, visibility controls
- **WCAG 2.2 AA Accessibility**: Keyboard navigation, screen reader support, focus management
- **Internationalization**: English and Spanish translations with react-i18next

### Planned Features
- Multi-modal RAG (images, PDFs)
- Streaming RAG responses
- Conversation history
- Fine-tuning support
- AI ballot proposition interpretation using civic profile data

---

**Next Steps**:
- Review [Provider Pattern](provider-pattern.md) for architecture details
- Read [Getting Started Guide](../guides/getting-started.md) to run the system
- Explore [AI/ML Pipeline](ai-ml-pipeline.md) for RAG implementation
