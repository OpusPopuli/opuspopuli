/**
 * Metrics Service
 *
 * Provides custom Prometheus metrics for the application.
 * Uses @willsoto/nestjs-prometheus for NestJS integration with prom-client.
 *
 * ## Key Points:
 * - Uses singleton registry via @willsoto/nestjs-prometheus
 * - Metrics are registered in MetricsModule via makeXxxProvider()
 * - Default Node.js metrics (heap, GC, event loop) enabled by default
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/213
 */
import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram, Gauge } from 'prom-client';

/**
 * Service for managing Prometheus metrics
 *
 * ## Metric Types:
 * - **Counter**: Values that only go up (requests, errors)
 * - **Histogram**: Distribution of values (latency percentiles)
 * - **Gauge**: Values that can go up or down (circuit breaker state)
 *
 * ## Label Guidelines:
 * - Keep cardinality low (avoid user IDs, request IDs)
 * - Use bounded values (HTTP methods, status codes, service names)
 */
@Injectable()
export class MetricsService {
  constructor(
    // HTTP Metrics - injected from module registration
    @InjectMetric('http_request_duration_seconds')
    private readonly httpRequestDuration: Histogram<string>,

    @InjectMetric('http_requests_total')
    private readonly httpRequestsTotal: Counter<string>,

    // GraphQL Metrics
    @InjectMetric('graphql_operations_total')
    private readonly graphqlOperationsTotal: Counter<string>,

    @InjectMetric('graphql_operation_duration_seconds')
    private readonly graphqlOperationDuration: Histogram<string>,

    // Circuit Breaker Metrics
    @InjectMetric('circuit_breaker_state')
    private readonly circuitBreakerState: Gauge<string>,

    @InjectMetric('circuit_breaker_failures_total')
    private readonly circuitBreakerFailures: Counter<string>,

    // Database Metrics
    @InjectMetric('db_query_duration_seconds')
    private readonly dbQueryDuration: Histogram<string>,

    // Federation Metrics
    @InjectMetric('federation_subgraph_request_duration_seconds')
    private readonly subgraphRequestDuration: Histogram<string>,
  ) {}

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
    service: string,
  ): void {
    const labels = {
      method,
      route: this.normalizeRoute(route),
      status_code: String(statusCode),
      service,
    };

    this.httpRequestDuration.observe(labels, durationSeconds);
    this.httpRequestsTotal.inc(labels);
  }

  /**
   * Record GraphQL operation metrics
   */
  recordGraphQLOperation(
    operationName: string,
    operationType: 'query' | 'mutation' | 'subscription',
    durationSeconds: number,
    service: string,
    status: 'success' | 'error',
  ): void {
    const labels = {
      operation_name: operationName || 'anonymous',
      operation_type: operationType,
      service,
    };

    this.graphqlOperationsTotal.inc({ ...labels, status });
    this.graphqlOperationDuration.observe(labels, durationSeconds);
  }

  /**
   * Update circuit breaker state
   *
   * @param state - 'closed' (0, healthy), 'half_open' (0.5, testing), 'open' (1, failing)
   */
  setCircuitBreakerState(
    service: string,
    circuitName: string,
    state: 'closed' | 'open' | 'half_open',
  ): void {
    const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 0.5;
    this.circuitBreakerState.set(
      { service, circuit_name: circuitName },
      stateValue,
    );
  }

  /**
   * Record circuit breaker failure
   */
  recordCircuitBreakerFailure(service: string, circuitName: string): void {
    this.circuitBreakerFailures.inc({ service, circuit_name: circuitName });
  }

  /**
   * Record database query duration
   */
  recordDbQuery(
    service: string,
    operation: string,
    table: string,
    durationSeconds: number,
  ): void {
    this.dbQueryDuration.observe(
      { service, operation, table },
      durationSeconds,
    );
  }

  /**
   * Record federation subgraph request duration
   * Used by the API gateway to track latency to each subgraph service
   */
  recordSubgraphRequest(subgraph: string, durationSeconds: number): void {
    this.subgraphRequestDuration.observe({ subgraph }, durationSeconds);
  }

  /**
   * Normalize route to reduce cardinality
   * Replace dynamic segments like UUIDs, IDs with placeholders
   */
  private normalizeRoute(route: string): string {
    return (
      route
        // Remove query strings first (no regex - safe from ReDoS)
        .split('?')[0]
        // Replace UUIDs
        .replaceAll(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          ':id',
        )
        // Replace numeric IDs
        .replaceAll(/\/\d+/g, '/:id')
    );
  }
}
