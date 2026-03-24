/**
 * OpenTelemetry Distributed Tracing Bootstrap
 *
 * This file MUST be imported before any other modules in each service's main.ts.
 * OTel needs to monkey-patch libraries (Express, HTTP, GraphQL, etc.) before they
 * are loaded by NestJS.
 *
 * Traces are exported via OTLP HTTP to Grafana Tempo.
 *
 * Configuration via environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — Tempo endpoint (default: http://localhost:4318)
 *   APPLICATION — service name (default: unknown-service)
 *   VERSION — service version (default: 0.0.0)
 *   OTEL_TRACING_ENABLED — set to "false" to disable (default: true)
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/466
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { isTest } from 'src/config/environment.config';

const isDisabled = isTest() || process.env.OTEL_TRACING_ENABLED === 'false';

if (!isDisabled) {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.APPLICATION || 'unknown-service',
      [ATTR_SERVICE_VERSION]: process.env.VERSION || '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation — too noisy, not useful for request tracing
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Disable DNS instrumentation — adds noise without value
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown
  const shutdown = () => {
    sdk.shutdown().catch(console.error);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
