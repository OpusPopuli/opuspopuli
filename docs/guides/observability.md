# Observability Guide

This guide covers monitoring, metrics, and logging for QCKSTRT services.

## Overview

QCKSTRT uses a standard observability stack:

| Tool | Purpose | Port |
|------|---------|------|
| **Prometheus** | Metrics collection and storage | 9090 |
| **Loki** | Log aggregation | 3100 |
| **Promtail** | Log shipping agent | - |
| **Grafana** | Visualization and dashboards | 3101 |

## Quick Start

```bash
# Start the observability stack
docker-compose up -d prometheus loki promtail grafana

# Open Grafana
open http://localhost:3101

# Login: admin / admin
```

## Metrics

### How It Works

1. Each microservice exposes a `/metrics` endpoint in Prometheus format
2. Prometheus scrapes these endpoints every 10-15 seconds
3. Grafana queries Prometheus to visualize the data

### Available Metrics

#### HTTP Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | method, route, status_code, service | Total request count |
| `http_request_duration_seconds` | Histogram | method, route, status_code, service | Request latency |

#### GraphQL Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `graphql_operations_total` | Counter | operation_name, operation_type, service, status | Operation count |
| `graphql_operation_duration_seconds` | Histogram | operation_name, operation_type, service | Operation latency |

#### Circuit Breaker Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `circuit_breaker_state` | Gauge | service, circuit_name | 0=closed, 0.5=half-open, 1=open |
| `circuit_breaker_failures_total` | Counter | service, circuit_name | Failure count |

#### Database Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `db_query_duration_seconds` | Histogram | service, operation, table | Query latency |

#### Node.js Runtime Metrics

Default metrics are automatically collected:

- `nodejs_heap_size_total_bytes` - Total heap size
- `nodejs_heap_size_used_bytes` - Used heap size
- `nodejs_eventloop_lag_seconds` - Event loop lag
- `nodejs_gc_duration_seconds` - Garbage collection duration
- `process_cpu_seconds_total` - CPU usage

### Viewing Metrics

```bash
# Raw metrics from a service
curl http://localhost:4001/metrics

# Query Prometheus
curl 'http://localhost:9090/api/v1/query?query=http_requests_total'
```

### Adding Custom Metrics

Inject the `MetricsService` and use its methods:

```typescript
import { MetricsService } from 'src/common/metrics';

@Injectable()
export class MyService {
  constructor(private readonly metrics: MetricsService) {}

  async processRequest() {
    const start = Date.now();

    // ... do work ...

    // Record DB query duration
    this.metrics.recordDbQuery(
      'my-service',
      'select',
      'users',
      (Date.now() - start) / 1000
    );
  }
}
```

### Histogram Buckets

HTTP/GraphQL latency buckets are optimized for API work:
- 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s

Database query buckets are tighter:
- 1ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s

## Logging

### How It Works

1. Services write logs to stdout/stderr (JSON format via `@qckstrt/logging-provider`)
2. Docker captures container logs
3. Promtail reads logs and ships to Loki
4. Grafana queries Loki for visualization

### Log Format

Logs are structured JSON:

```json
{
  "level": "info",
  "message": "User logged in",
  "context": "AuthService",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "userId": "uuid-here"
}
```

### Querying Logs

In Grafana (Explore > Loki):

```logql
# All logs from a service
{service="qckstrt-users-service"}

# Error logs only
{container=~"qckstrt-.*"} |= "error"

# Filter by log level
{service="qckstrt-api-gateway"} | json | level="error"

# Search for specific text
{container=~"qckstrt-.*"} |= "authentication failed"
```

### Log Labels

Promtail automatically adds these labels:

| Label | Description |
|-------|-------------|
| `container` | Container name (e.g., `qckstrt-users-service`) |
| `service` | Service name (stripped prefix) |
| `compose_service` | Docker Compose service name |
| `level` | Log level (if JSON parsed) |
| `context` | NestJS context (if JSON parsed) |

## Grafana Dashboards

### Pre-configured Dashboards

1. **QCKSTRT Services** - Overview of all services
   - Request rate by service
   - Error rate (5xx responses)
   - Latency percentiles (p50, p95)
   - GraphQL operations
   - Circuit breaker states
   - Database query latency

### Creating Custom Dashboards

1. Open Grafana at http://localhost:3101
2. Go to Dashboards > New > New Dashboard
3. Add panels using Prometheus or Loki queries

Example Prometheus queries:

```promql
# Request rate
sum(rate(http_requests_total[1m])) by (service)

# Error rate
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service)
/ sum(rate(http_requests_total[5m])) by (service)

# P95 latency
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (service, le)
)

# Heap usage
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes
```

## Alerting

### Setting Up Alerts

1. In Grafana, go to Alerting > Alert rules
2. Create a new rule with a Prometheus query
3. Set thresholds and notification channels

Example alert conditions:

```promql
# High error rate
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service)
/ sum(rate(http_requests_total[5m])) by (service) > 0.05

# Circuit breaker open
circuit_breaker_state == 1

# High latency
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (service, le)
) > 1
```

## Configuration Files

### Prometheus Configuration

`observability/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'api-gateway'
    static_configs:
      - targets: ['host.docker.internal:4000']
    metrics_path: /metrics
```

### Loki Configuration

`observability/loki.yml`:

```yaml
auth_enabled: false
server:
  http_listen_port: 3100

schema_config:
  configs:
    - from: 2020-10-24
      store: tsdb
      object_store: filesystem
      schema: v13
```

### Promtail Configuration

`observability/promtail.yml`:

```yaml
scrape_configs:
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/qckstrt-.*'
        action: keep
```

## Troubleshooting

### Prometheus not scraping

```bash
# Check targets
curl http://localhost:9090/api/v1/targets

# Verify service is up and exposing metrics
curl http://localhost:4001/metrics
```

### Logs not appearing in Loki

```bash
# Check Promtail is running
docker logs qckstrt-promtail

# Verify Docker socket access
docker exec qckstrt-promtail ls -la /var/run/docker.sock
```

### Missing default metrics

Ensure `MetricsModule` is imported with `defaultMetrics: true` (default):

```typescript
MetricsModule.forRoot({
  serviceName: 'my-service',
  defaultMetrics: true // This is the default
})
```

## Production Considerations

1. **Retention**: Configure appropriate retention periods
   - Prometheus: `--storage.tsdb.retention.time=15d`
   - Loki: `limits_config.reject_old_samples_max_age`

2. **Remote storage**: For production, consider:
   - Prometheus remote write to Thanos/Mimir
   - Loki with S3/GCS backend

3. **High availability**: Run multiple replicas with:
   - Prometheus federation
   - Loki in microservices mode

4. **Alerting**: Set up Alertmanager with notification channels

5. **Security**: Use authentication for Grafana in production:
   ```yaml
   environment:
     GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
     GF_AUTH_ANONYMOUS_ENABLED: "false"
   ```
