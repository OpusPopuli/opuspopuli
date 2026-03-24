# Distributed Tracing (OpenTelemetry)

Opus Populi uses [OpenTelemetry](https://opentelemetry.io/) for distributed tracing across all 5 backend microservices. Traces are collected by [Grafana Tempo](https://grafana.com/oss/tempo/) and visualized in Grafana alongside metrics (Prometheus) and logs (Loki).

## Architecture

```
Browser Request
  ↓
API Gateway (api) ──traceparent──→ Users Service
                  ──traceparent──→ Documents Service
                  ──traceparent──→ Knowledge Service
                  ──traceparent──→ Region Service
  ↓                                     ↓
  └──── OTLP HTTP ────→ Grafana Tempo ←─┘
                            ↓
                         Grafana
                     (traces + logs + metrics)
```

Each service auto-instruments HTTP, Express, and GraphQL using the OpenTelemetry Node.js SDK. The Apollo Federation gateway propagates W3C `traceparent` headers to subgraph services via the HMAC data source.

## How It Works

1. **Tracing bootstrap** (`src/common/tracing.ts`) initializes the OTel SDK before NestJS loads — this is imported first in every service's `main.ts`
2. **Auto-instrumentation** patches Express, HTTP client, GraphQL, and other libraries to create spans automatically
3. **Trace context propagation** — the gateway forwards `traceparent` headers to subgraphs so spans link into a single trace
4. **Log correlation** — the structured logger (`@opuspopuli/logging-provider`) injects `traceId` and `spanId` into every log entry

## Viewing Traces in Grafana

1. Open Grafana at http://localhost:3101 (dev) or http://localhost:3101 on the Mac Studio (prod)
2. Go to **Explore** → select **Tempo** datasource
3. Search by:
   - **Service name** — filter by `api`, `users`, `documents`, `knowledge`, or `region`
   - **Duration** — find slow requests (e.g., `> 1s`)
   - **Trace ID** — paste a specific trace ID from logs

## Correlating Logs and Traces

Every structured log entry includes `traceId` and `spanId` fields. In Grafana:

- **Log → Trace**: In Loki, click the **TraceID** link on any log line to jump to the full trace in Tempo
- **Trace → Logs**: In Tempo, click **Logs for this span** to see all log entries associated with a trace

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Tempo OTLP receiver URL |
| `OTEL_TRACING_ENABLED` | `true` | Set to `false` to disable tracing |
| `APPLICATION` | `unknown-service` | Service name reported in traces |
| `VERSION` | `0.0.0` | Service version reported in traces |

In Docker Compose, the endpoint is set to `http://tempo:4318` automatically. For local development (services running on host), the default `http://localhost:4318` works when Tempo is running in Docker.

Tracing is automatically disabled in test environments (`NODE_ENV=test`).

## Infrastructure

| Service | Port | Purpose |
|---|---|---|
| Tempo | 4318 | OTLP HTTP receiver (traces in) |
| Tempo | 3200 | Query API (Grafana reads from here) |

Tempo stores traces locally with 7-day retention. Configuration: `observability/tempo.yml`.

## Related

- [Observability Guide](./observability.md) — Prometheus metrics, Loki logs, Grafana dashboards
- [Deployment Architecture](../architecture/deployment.md) — Infrastructure topology
