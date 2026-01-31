# Docker Setup - OSS Self-Hosted Stack

This project uses a 100% open-source, self-hosted AI/ML stack for maximum transparency and privacy.

## Services

Your `docker-compose.yml` includes:

### Core Services

| Service | Purpose | Port | Image |
|---------|---------|------|-------|
| **PostgreSQL + pgvector** | Relational + Vector database | 5432 | Supabase stack |
| **Supabase Auth** | Authentication (Passkeys, Magic Links) | - | `supabase/gotrue` |
| **Supabase Storage** | File storage | - | `supabase/storage-api` |
| **Supabase Studio** | Admin UI | 3100 | `supabase/studio` |
| **Ollama** | LLM inference (Falcon 7B) | 11434 | `ollama/ollama` |
| **Redis** | Caching and rate limiting | 6379 | `redis:7-alpine` |
| **Inbucket** | Local email testing | 54324 | `inbucket/inbucket` |

### Observability Stack

| Service | Purpose | Port | Image |
|---------|---------|------|-------|
| **Prometheus** | Metrics collection | 9090 | `prom/prometheus` |
| **Loki** | Log aggregation | 3100 | `grafana/loki` |
| **Promtail** | Log shipper | - | `grafana/promtail` |
| **Grafana** | Visualization | 3101 | `grafana/grafana` |

## Quick Start

### 1. Start all services

```bash
docker-compose up -d
```

### 2. Pull the Falcon 7B model

```bash
./scripts/setup-ollama.sh
```

Or manually:
```bash
docker exec qckstrt-ollama ollama pull falcon
```

### 3. Verify everything is running

```bash
# Check all containers
docker-compose ps

# Check PostgreSQL
docker exec qckstrt-supabase-db pg_isready -U postgres

# Check pgvector extension
docker exec qckstrt-supabase-db psql -U postgres -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Check Ollama
docker exec qckstrt-ollama ollama list

# Check Redis
docker exec qckstrt-redis redis-cli ping

# Check Prometheus
curl http://localhost:9090/-/healthy
```

## Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| Supabase API | http://localhost:8000 | - |
| Supabase Studio | http://localhost:3100 | - |
| Inbucket (Email) | http://localhost:54324 | - |
| PostgreSQL | localhost:5432 | `postgres` / from .env |
| Ollama | http://localhost:11434 | - |
| Redis | localhost:6379 | - |
| Prometheus | http://localhost:9090 | - |
| Grafana | http://localhost:3101 | `admin` / `admin` |

## Observability

### Prometheus Metrics

Each microservice exposes metrics at `/metrics`:

```bash
# View metrics from users-service
curl http://localhost:4001/metrics

# View metrics from api-gateway
curl http://localhost:4000/metrics
```

Available metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests by method, route, status |
| `http_request_duration_seconds` | Histogram | Request latency (p50, p95, p99) |
| `graphql_operations_total` | Counter | GraphQL operations by type |
| `graphql_operation_duration_seconds` | Histogram | GraphQL latency |
| `circuit_breaker_state` | Gauge | Circuit breaker status |
| `db_query_duration_seconds` | Histogram | Database query latency |

Default Node.js metrics (heap, GC, event loop) are also included.

### Grafana Dashboards

Pre-configured dashboards are available at http://localhost:3101:

1. **QCKSTRT Services** - Request rates, error rates, latency percentiles
2. Explore logs via the Loki datasource

### Loki Logs

Container logs are automatically collected by Promtail and sent to Loki:

```bash
# Query logs in Grafana
# Go to Explore > Select Loki > Enter query:
{service="qckstrt-supabase-db"}
{container=~"qckstrt-.*"} |= "error"
```

## Configuration

Your application is configured to use these services via environment variables in `apps/backend/.env`:

```bash
# Embeddings: Xenova (in-process, no external service needed)
EMBEDDINGS_PROVIDER='xenova'

# Vector DB: pgvector (uses same PostgreSQL instance)
VECTOR_DB_DIMENSIONS=384

# LLM: Ollama with Falcon 7B
LLM_URL='http://localhost:11434'
LLM_MODEL='falcon'

# Redis: Caching and rate limiting
REDIS_URL='redis://localhost:6379'
```

## Development Workflow

### Start services
```bash
docker-compose up -d
```

### Stop services
```bash
docker-compose down
```

### Stop and remove all data
```bash
docker-compose down -v
```

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f ollama

# Or use Grafana/Loki at http://localhost:3101
```

## Switching Models

To use a different Ollama model:

1. Pull the model:
```bash
docker exec qckstrt-ollama ollama pull mistral
```

2. Update `apps/backend/.env`:
```bash
LLM_MODEL='mistral'
```

3. Restart your backend application

Available models: https://ollama.ai/library

## GPU Support (Optional)

If you have an NVIDIA GPU and want faster inference:

1. Install [nvidia-docker](https://github.com/NVIDIA/nvidia-docker)

2. Uncomment the GPU section in `docker-compose.yml`:
```yaml
ollama:
  # ...
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

3. Restart the Ollama container:
```bash
docker-compose up -d ollama
```

## Data Persistence

All data is persisted in Docker volumes:

| Volume | Purpose |
|--------|---------|
| `qckstrt-supabase-db-data` | PostgreSQL database |
| `qckstrt-supabase-storage-data` | File uploads |
| `qckstrt-ollama-data` | Downloaded LLM models |
| `qckstrt-redis-data` | Cache data |
| `qckstrt-prometheus-data` | Metrics history (15 days) |
| `qckstrt-loki-data` | Log history |
| `qckstrt-grafana-data` | Dashboards and settings |

To backup:
```bash
docker volume inspect qckstrt-supabase-db-data
docker volume inspect qckstrt-ollama-data
```

## Troubleshooting

### Ollama model not found
```bash
# Pull the model again
docker exec qckstrt-ollama ollama pull falcon

# Verify it's installed
docker exec qckstrt-ollama ollama list
```

### PostgreSQL connection issues
```bash
# Check if it's ready
docker exec qckstrt-supabase-db pg_isready -U postgres

# View logs
docker-compose logs supabase-db
```

### pgvector extension not available
```bash
# Check if extension is installed
docker exec qckstrt-supabase-db psql -U postgres -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"

# Install if needed
docker exec qckstrt-supabase-db psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Redis connection issues
```bash
# Check Redis is running
docker exec qckstrt-redis redis-cli ping

# View Redis info
docker exec qckstrt-redis redis-cli info
```

### Prometheus not scraping metrics
```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Verify service is exposing metrics
curl http://localhost:4001/metrics
```

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Your Application                            │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────┐  ┌───────┐  ┌────────┐ │
│  │ Xenova   │  │PostgreSQL│  │Ollama │  │ Redis │  │Supabase│ │
│  │(in-proc) │  │+ pgvector│  │ (LLM) │  │(cache)│  │ (auth) │ │
│  └──────────┘  └──────────┘  └───────┘  └───────┘  └────────┘ │
│                     ↓            ↓          ↓          ↓       │
│              localhost:5432  :11434     :6379      :8000       │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│                    Observability Stack                         │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Prometheus│  │   Loki   │  │ Promtail │  │    Grafana    │  │
│  │(metrics) │  │  (logs)  │  │(shipper) │  │(visualization)│  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│       :9090        :3100          -              :3101         │
└────────────────────────────────────────────────────────────────┘

100% OSS • 100% Self-Hosted • 100% Private
```

## Production Deployment

For production, consider:

1. **Use managed PostgreSQL with pgvector** (AWS RDS, Supabase Cloud, etc.)
2. **Deploy Ollama** on GPU instances for better performance
3. **Use environment-specific configs** (production.env)
4. **Configure Prometheus federation** for multi-cluster monitoring
5. **Set up alerting** via Alertmanager

See the platform packages for implementations:
- `packages/relationaldb-provider/` - PostgreSQL provider
- `packages/vectordb-provider/` - pgvector provider
- `packages/llm-provider/` - Ollama provider
- `packages/extraction-provider/` - Text extraction with Redis caching
