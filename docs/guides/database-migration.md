# Database Migration Guide

This guide covers migrating between different database configurations.

## Architecture Overview

Opus Populi uses PostgreSQL with pgvector for both relational and vector data, consolidating all data in a single database.

```
PostgreSQL (via Supabase)
├── Relational Tables (users, documents, etc.)
└── Vector Tables (embeddings with pgvector extension)
```

---

## Development → Production Migration

**Full migration** from development stack to production stack.

### Development Stack (Supabase Self-Hosted)
```
- Relational DB: PostgreSQL (via Supabase)
- Vector DB: pgvector (same PostgreSQL)
- Embeddings: Xenova
- LLM: Ollama (Falcon 7B)
- Auth: Supabase Auth (GoTrue)
- Storage: Supabase Storage
- Secrets: Supabase Vault
```

### Production Stack
```
- Relational DB: Supabase Cloud PostgreSQL (or any managed PostgreSQL)
- Vector DB: pgvector (same PostgreSQL)
- Embeddings: Xenova (same, in-process)
- LLM: Ollama (local or GPU instance)
- Auth: Supabase Auth
- Storage: Cloudflare R2 or Supabase Storage
- Secrets: Environment variables (via SECRETS_PROVIDER=env)
```

### Migration Steps

**1. Set up PostgreSQL with pgvector**:
```bash
# Use Supabase Cloud (recommended) or any managed PostgreSQL with pgvector
# Install pgvector (once connected, if not pre-installed)
CREATE EXTENSION vector;
```

**2. Update configuration**:
```bash
# Production .env
NODE_ENV=production

RELATIONAL_DB_PROVIDER=postgres
RELATIONAL_DB_HOST=db.your-project.supabase.co
RELATIONAL_DB_PORT=5432
RELATIONAL_DB_DATABASE=postgres
RELATIONAL_DB_USERNAME=postgres
RELATIONAL_DB_PASSWORD=<secure-password>
RELATIONAL_DB_SSL=true

VECTOR_DB_DIMENSIONS=384

EMBEDDINGS_PROVIDER=xenova
EMBEDDINGS_XENOVA_MODEL=Xenova/all-MiniLM-L6-v2

LLM_URL=http://localhost:11434
LLM_MODEL=mistral
```

**3. Migrate data**:
```bash
# Export from Supabase PostgreSQL (dev)
docker exec opuspopuli-supabase-db pg_dump -U postgres postgres > dev-data.sql

# Import to production PostgreSQL
psql -h db.your-project.supabase.co \
     -U postgres \
     -d postgres \
     < dev-data.sql
```

**4. Re-index documents** (recommended for fresh embeddings):
```typescript
// Re-index ensures embeddings match production configuration
for (const document of documents) {
  await knowledgeService.indexDocument(
    document.userId,
    document.id,
    document.content
  );
}
```

**5. Deploy application**:
```bash
# Build for production
npm run build

# Deploy to ECS/Kubernetes/etc.
# (deployment-specific steps)
```

**6. Verify production**:
- Test user authentication
- Upload test document
- Verify RAG queries work
- Check database connections
- Monitor logs for errors

---

## Best Practices

### 1. Backup Before Migration

```bash
# Backup PostgreSQL (includes pgvector data)
docker exec opuspopuli-supabase-db pg_dump -U postgres postgres > backup-$(date +%Y%m%d).sql
```

### 2. Test in Staging First

Never migrate production directly:
1. Set up staging environment
2. Migrate staging database
3. Test thoroughly
4. Only then migrate production

### 3. Plan Downtime

- Schedule migration during low-traffic periods
- Notify users of maintenance window
- Have rollback plan ready

### 4. Verify Data Integrity

```sql
-- Check record counts match
SELECT 'users' AS table_name, COUNT(*) FROM users
UNION ALL
SELECT 'documents', COUNT(*) FROM documents
UNION ALL
SELECT 'vector_embeddings', COUNT(*) FROM vector_embeddings;
```

### 5. Monitor After Migration

- Watch error logs
- Check query performance
- Monitor database metrics
- Verify user workflows

---

## Troubleshooting

### Migration fails with "relation already exists"

**Cause**: Tables already exist in target database

**Solution**:
```sql
-- Drop existing tables (CAUTION: data loss)
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS vector_embeddings CASCADE;

-- Then retry migration
```

### Vector dimensions mismatch

**Error**: `ERROR: dimensions for type vector(768) must be at least 1 and at most 16000`

**Cause**: Embedding model dimensions don't match table configuration

**Solution**:
```bash
# Verify embedding model dimensions
EMBEDDINGS_XENOVA_MODEL=Xenova/all-MiniLM-L6-v2  # 384 dimensions

# Update pgvector config
VECTOR_DB_DIMENSIONS=384  # Must match!

# Re-create table with correct dimensions if needed
DROP TABLE vector_embeddings;
# Let the provider recreate it on startup
```

### Slow queries after migration

**Cause**: Missing indexes in PostgreSQL

**Solution**:
```sql
-- Add indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_documents_user_id ON documents(user_id);

-- For pgvector, ensure HNSW index exists
CREATE INDEX IF NOT EXISTS idx_embedding_hnsw
  ON vector_embeddings
  USING hnsw (embedding vector_cosine_ops);
```

### pgvector extension not available

**Cause**: PostgreSQL instance doesn't have pgvector installed

**Solution**:
```sql
-- Check if extension is available
SELECT * FROM pg_available_extensions WHERE name = 'vector';

-- If not available, you need to install it on the database server
-- For managed PostgreSQL, use a version that supports pgvector
-- For self-hosted, install pgvector from source or package manager
```

---

## Related Documentation

- [Data Layer Architecture](../architecture/data-layer.md) - Database details
- [Provider Pattern](../architecture/provider-pattern.md) - How providers work
- [Docker Setup](docker-setup.md) - Infrastructure configuration
- [Getting Started](getting-started.md) - Initial setup
