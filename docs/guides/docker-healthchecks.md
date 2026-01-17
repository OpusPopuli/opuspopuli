# Docker Health Checks

This guide explains the Docker HEALTHCHECK configurations for the QCKSTRT platform and how to customize them for your environment.

## Why Health Checks Matter

Docker health checks provide several benefits:

- **Container orchestration**: Docker Compose and Kubernetes can wait for healthy containers before starting dependent services
- **Automatic recovery**: Restart policies can use health status to restart failing containers
- **Visibility**: `docker ps` and `docker stats` show container health status
- **Load balancing**: Container orchestrators can route traffic only to healthy containers

## Health Check Configuration

### HEALTHCHECK Instruction

Health checks are configured in Dockerfiles using the `HEALTHCHECK` instruction:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD <health-check-command>
```

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--interval` | Time between health checks | 30s |
| `--timeout` | Maximum time for check to complete | 30s |
| `--start-period` | Grace period for container startup | 0s |
| `--retries` | Consecutive failures before unhealthy | 3 |

### Health Status

Containers have three health states:
- **starting**: Container is in start_period
- **healthy**: Health check passed
- **unhealthy**: Health check failed (retries exceeded)

## Service Health Checks

### Backend Services (NestJS)

All backend services use Node.js HTTP checks against the `/health` endpoint:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
```

**Services**: api, users, files, vectors

The `/health` endpoint returns:
- Liveness status
- Readiness status
- Database connectivity
- Memory usage

### Frontend (Next.js)

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
```

Uses a longer `start_period` (60s) because Next.js needs time to compile and start.

### Nginx

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
```

Uses `wget` (available in Alpine) for HTTP health checks.

### Supabase Services

| Service | Health Check | Port |
|---------|--------------|------|
| PostgreSQL | `pg_isready -U postgres` | 5432 |
| GoTrue (Auth) | HTTP `/health` | 9999 |
| PostgREST | HTTP `/` | 3000 |
| Storage API | HTTP `/status` | 5000 |
| Imgproxy | `imgproxy health` | 8080 |
| Kong | `kong health` | 8000 |
| Studio | HTTP `/` | 3000 |
| Postgres Meta | HTTP `/health` | 8080 |

### Ollama

```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:11434/ || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

Uses a longer `start_period` (60s) because model loading can take time.

## Docker Compose Configuration

### Health Check in docker-compose.yml

```yaml
services:
  my-service:
    build: .
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

### Health Dependencies

Use `depends_on` with `condition: service_healthy` to wait for healthy services:

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
```

**Note**: This requires Docker Compose V2 or later.

## Monitoring Health Status

### Check Container Health

```bash
# View health status of all containers
docker ps

# View detailed health info for a container
docker inspect --format='{{json .State.Health}}' <container_name> | jq

# Watch health status
watch docker ps --format "table {{.Names}}\t{{.Status}}"
```

### Health Check Logs

```bash
# View recent health check results
docker inspect --format='{{range .State.Health.Log}}{{.End}}: {{.ExitCode}} - {{.Output}}{{end}}' <container_name>
```

## Tuning Health Checks

### Slow-Starting Services

Increase `start_period` for services that need time to initialize:

```dockerfile
HEALTHCHECK --start-period=120s ...
```

### Resource-Constrained Environments

Increase `interval` to reduce health check frequency:

```dockerfile
HEALTHCHECK --interval=60s ...
```

### Flaky Network Conditions

Increase `retries` to tolerate temporary failures:

```dockerfile
HEALTHCHECK --retries=5 ...
```

### Quick Failure Detection

Decrease `interval` and `retries` for faster detection:

```dockerfile
HEALTHCHECK --interval=10s --retries=2 ...
```

## Troubleshooting

### Container Stuck in "starting"

The container hasn't passed a health check within `start_period`. Check:
1. Is the application actually starting?
2. Is the health endpoint accessible?
3. Is `start_period` long enough?

```bash
docker logs <container_name>
```

### Container Unhealthy

The health check is failing. Debug with:

```bash
# Run the health check manually
docker exec <container_name> <health-check-command>

# Check recent health check results
docker inspect <container_name> --format='{{json .State.Health}}' | jq
```

### Health Check Command Not Found

Ensure the health check tool is available in the container:
- `curl`: Install with `apt-get install curl` or `apk add curl`
- `wget`: Available in Alpine images
- `node`: Available in Node.js images

## Best Practices

1. **Use appropriate endpoints**: Prefer dedicated health endpoints over root paths
2. **Include dependency checks**: Health endpoints should verify database connectivity
3. **Set realistic timeouts**: Allow enough time for checks but not too long
4. **Use start_period**: Give services time to initialize
5. **Keep checks lightweight**: Health checks run frequently
6. **Handle errors gracefully**: Return proper exit codes

## Related Documentation

- [Docker Setup Guide](./docker-setup.md)
- [Container Resources](./container-resources.md)
