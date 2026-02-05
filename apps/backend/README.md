# OPUSPOPULI Backend

NestJS microservices with GraphQL Federation and pluggable provider architecture.

## Documentation

See the main documentation for detailed information:

- **[Getting Started](../../docs/guides/getting-started.md)** - Setup and development
- **[System Overview](../../docs/architecture/system-overview.md)** - Architecture details
- **[Provider Pattern](../../docs/architecture/provider-pattern.md)** - How providers work
- **[AI/ML Pipeline](../../docs/architecture/ai-ml-pipeline.md)** - RAG implementation

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all microservices
pnpm start

# Start specific service
pnpm start:api        # API Gateway
pnpm start:knowledge  # Knowledge/RAG service

# Build
pnpm build

# Test
pnpm test
```

## Microservices

| Service | Port | Purpose |
|---------|------|---------|
| API Gateway | 3000 | GraphQL Federation gateway |
| Users | 3001 | User management, authentication (Passkeys, Magic Links, Password), profiles, consents |
| Documents | 3002 | Document storage |
| Knowledge | 3003 | RAG/semantic search |
| Files | 3004 | File processing |

## Health Endpoints

All services provide health check endpoints for Kubernetes liveness and readiness probes:

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `/health` | Full health status | Database, memory, uptime, version |
| `/health/live` | Liveness probe | Is the process running? |
| `/health/ready` | Readiness probe | Can the service handle requests? |

**Example Response (GET /health):**
```json
{
  "status": "ok",
  "info": {
    "memory": { "status": "up", "heapUsed": "45.23MB" },
    "database": { "status": "up", "responseTime": "3ms" },
    "service": { "status": "up", "name": "users-service", "uptime": 3600 }
  }
}
```

> **Note:** Health endpoints are excluded from HMAC authentication to allow direct Kubernetes probe access. They are only accessible within the cluster network. See [SECURITY.md](../../SECURITY.md#health-endpoints-kubernetes-probes) for details.

## User Profile GraphQL API

The Users service includes a comprehensive profile management API:

### Profile Management
- `myProfile` / `updateMyProfile` - Extended user profile data (name, phone, timezone, bio)

### Address Management
- `myAddresses` / `createAddress` / `updateAddress` / `deleteAddress`
- `setPrimaryAddress` - Set default address
- Includes civic boundary data (congressional district, state senate/assembly, county, precinct)

### Notification Preferences
- `myNotificationPreferences` / `updateNotificationPreferences`
- `unsubscribeFromAll` - One-click unsubscribe
- Supports email, push, SMS, and civic-specific notifications

### Consent Management (GDPR/CCPA)
- `myConsents` / `updateConsent` / `withdrawConsent`
- `bulkUpdateConsents` - Update multiple consents at once
- `hasValidConsent` - Check if specific consent is valid
- Full audit trail with IP, user agent, timestamps

## Configuration

Edit `.env` file for local development:

```bash
# Authentication (Supabase Auth with Passwordless)
AUTH_PROVIDER=supabase
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# WebAuthn/Passkeys
WEBAUTHN_RP_NAME=Opus Populi
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Embeddings
EMBEDDINGS_PROVIDER=xenova

# Vector Database (pgvector uses same PostgreSQL instance)
# Falls back to RELATIONAL_DB_* if not specified
VECTOR_DB_DIMENSIONS=384

# LLM
LLM_URL=http://localhost:11434
LLM_MODEL=falcon

# Relational Database (PostgreSQL via Supabase)
RELATIONAL_DB_PROVIDER=postgres
RELATIONAL_DB_HOST=localhost
RELATIONAL_DB_PORT=5432
RELATIONAL_DB_DATABASE=postgres
RELATIONAL_DB_USERNAME=postgres
RELATIONAL_DB_PASSWORD=your-super-secret-password
```

See [Getting Started Guide](../../docs/guides/getting-started.md) for more details.
