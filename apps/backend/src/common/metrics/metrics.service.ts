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
 * - Database pool metrics collected every 15s via Prisma metrics API
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/213
 */
import {
  Injectable,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram, Gauge } from 'prom-client';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { MetricsModuleOptions } from './metrics.module';

/**
 * Service for managing Prometheus metrics
 *
 * ## Metric Types:
 * - **Counter**: Values that only go up (requests, errors)
 * - **Histogram**: Distribution of values (latency percentiles)
 * - **Gauge**: Values that can go up or down (circuit breaker state, pool size)
 *
 * ## Label Guidelines:
 * - Keep cardinality low (avoid user IDs, request IDs)
 * - Use bounded values (HTTP methods, status codes, service names)
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private poolMetricsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject('METRICS_OPTIONS')
    private readonly options: MetricsModuleOptions,

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

    // Database Pool Metrics
    @InjectMetric('db_pool_connections_open')
    private readonly dbPoolOpen: Gauge<string>,

    @InjectMetric('db_pool_connections_idle')
    private readonly dbPoolIdle: Gauge<string>,

    @InjectMetric('db_pool_connections_busy')
    private readonly dbPoolBusy: Gauge<string>,

    // Business Metrics: Document Processing Pipeline
    // @see https://github.com/OpusPopuli/opuspopuli/issues/308
    @InjectMetric('document_scans_total')
    private readonly documentScansTotal: Counter<string>,

    @InjectMetric('document_scan_duration_seconds')
    private readonly documentScanDuration: Histogram<string>,

    @InjectMetric('ocr_extractions_total')
    private readonly ocrExtractionsTotal: Counter<string>,

    @InjectMetric('ocr_confidence')
    private readonly ocrConfidenceHistogram: Histogram<string>,

    @InjectMetric('document_analyses_total')
    private readonly documentAnalysesTotal: Counter<string>,

    @InjectMetric('document_analysis_duration_seconds')
    private readonly documentAnalysisDuration: Histogram<string>,

    @InjectMetric('document_analysis_cache_hits_total')
    private readonly analysisCacheHits: Counter<string>,

    @InjectMetric('document_analysis_cache_misses_total')
    private readonly analysisCacheMisses: Counter<string>,

    // Optional: DbService for pool metrics collection
    @Optional()
    private readonly dbService?: DbService,
  ) {}

  onModuleInit() {
    if (this.dbService) {
      this.poolMetricsInterval = setInterval(async () => {
        try {
          const metrics = await this.dbService!.getPoolMetrics();
          if (metrics) {
            const service = this.options.serviceName;
            this.dbPoolOpen.set({ service }, metrics.open);
            this.dbPoolIdle.set({ service }, metrics.idle);
            this.dbPoolBusy.set({ service }, metrics.busy);
          }
        } catch {
          // Silently ignore collection errors
        }
      }, 15_000);
    }
  }

  onModuleDestroy() {
    if (this.poolMetricsInterval) {
      clearInterval(this.poolMetricsInterval);
      this.poolMetricsInterval = null;
    }
  }

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
    const stateValues: Record<typeof state, number> = {
      closed: 0,
      open: 1,
      half_open: 0.5,
    };
    this.circuitBreakerState.set(
      { service, circuit_name: circuitName },
      stateValues[state],
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

  // === Business Metrics: Document Processing Pipeline ===
  // @see https://github.com/OpusPopuli/opuspopuli/issues/308

  /**
   * Record a document scan completion (success or failure)
   * Duration is only observed on success — failed scans may abort early.
   */
  recordScanProcessed(
    service: string,
    documentType: string,
    status: 'success' | 'failure',
    durationSeconds: number,
  ): void {
    this.documentScansTotal.inc({
      service,
      document_type: documentType,
      status,
    });
    if (status === 'success') {
      this.documentScanDuration.observe(
        { service, document_type: documentType },
        durationSeconds,
      );
    }
  }

  /**
   * Record OCR extraction outcome
   * Confidence is only observed on success.
   */
  recordOcrExtraction(
    service: string,
    provider: string,
    status: 'success' | 'failure',
    confidence?: number,
  ): void {
    this.ocrExtractionsTotal.inc({ service, provider, status });
    if (status === 'success' && confidence !== undefined) {
      this.ocrConfidenceHistogram.observe({ service, provider }, confidence);
    }
  }

  /**
   * Record document analysis outcome
   * Duration is only observed on success.
   */
  recordAnalysis(
    service: string,
    documentType: string,
    status: 'success' | 'failure',
    durationSeconds: number,
  ): void {
    this.documentAnalysesTotal.inc({
      service,
      document_type: documentType,
      status,
    });
    if (status === 'success') {
      this.documentAnalysisDuration.observe(
        { service, document_type: documentType },
        durationSeconds,
      );
    }
  }

  /**
   * Record analysis cache hit
   */
  recordAnalysisCacheHit(service: string): void {
    this.analysisCacheHits.inc({ service });
  }

  /**
   * Record analysis cache miss
   */
  recordAnalysisCacheMiss(service: string): void {
    this.analysisCacheMisses.inc({ service });
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
