/**
 * Metrics Module
 *
 * Provides Prometheus metrics endpoints and automatic request tracking.
 *
 * ## What Prometheus Does:
 * 1. Your service exposes metrics at /metrics in a simple text format
 * 2. Prometheus server scrapes this endpoint periodically (every 15-30s)
 * 3. Prometheus stores the time-series data
 * 4. Grafana visualizes the data with dashboards
 *
 * ## Endpoints:
 * - GET /metrics - Prometheus metrics in text format
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/213
 */
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';

/**
 * Metrics Module Configuration Options
 */
export interface MetricsModuleOptions {
  /**
   * Service name for metric labels
   */
  serviceName: string;

  /**
   * Path for metrics endpoint
   * @default '/metrics'
   */
  metricsPath?: string;

  /**
   * Enable default Node.js metrics (memory, CPU, event loop)
   * @default true
   */
  defaultMetrics?: boolean;
}

/**
 * Metrics Module
 *
 * @example
 * ```typescript
 * // In your app.module.ts
 * import { MetricsModule } from 'src/common/metrics';
 *
 * @Module({
 *   imports: [
 *     MetricsModule.forRoot({ serviceName: 'users-service' }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class MetricsModule {
  static forRoot(options: MetricsModuleOptions): DynamicModule {
    const metricsPath = options.metricsPath || '/metrics';
    const defaultMetrics = options.defaultMetrics ?? true;

    const providers: Provider[] = [
      {
        provide: 'METRICS_OPTIONS',
        useValue: options,
      },
      MetricsService,
      // Register the interceptor globally for automatic HTTP metrics
      {
        provide: APP_INTERCEPTOR,
        useClass: MetricsInterceptor,
      },
      // Register custom metrics with the Prometheus registry
      makeCounterProvider({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code', 'service'],
      }),
      makeHistogramProvider({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code', 'service'],
        // Tighter buckets for API work: 5ms to 2.5s with more granularity in 10-100ms range
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      }),
      makeCounterProvider({
        name: 'graphql_operations_total',
        help: 'Total number of GraphQL operations',
        labelNames: ['operation_name', 'operation_type', 'service', 'status'],
      }),
      makeHistogramProvider({
        name: 'graphql_operation_duration_seconds',
        help: 'Duration of GraphQL operations in seconds',
        labelNames: ['operation_name', 'operation_type', 'service'],
        // Tighter buckets for GraphQL: same as HTTP for consistency
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      }),
      makeGaugeProvider({
        name: 'circuit_breaker_state',
        help: 'Circuit breaker state (0=closed, 0.5=half-open, 1=open)',
        labelNames: ['service', 'circuit_name'],
      }),
      makeCounterProvider({
        name: 'circuit_breaker_failures_total',
        help: 'Total circuit breaker failures',
        labelNames: ['service', 'circuit_name'],
      }),
      makeHistogramProvider({
        name: 'db_query_duration_seconds',
        help: 'Duration of database queries in seconds',
        labelNames: ['service', 'operation', 'table'],
        buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      }),
      // Federation subgraph metrics for measuring gateway-to-subgraph latency
      makeHistogramProvider({
        name: 'federation_subgraph_request_duration_seconds',
        help: 'Duration of federation subgraph requests in seconds',
        labelNames: ['subgraph'],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      }),
    ];

    return {
      module: MetricsModule,
      imports: [
        PrometheusModule.register({
          path: metricsPath,
          defaultMetrics: {
            enabled: defaultMetrics,
            config: {
              // Add service label to all default metrics
              labels: { service: options.serviceName },
            },
          },
        }),
      ],
      providers,
      exports: [MetricsService, 'METRICS_OPTIONS'],
    };
  }
}
