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
 * A GraphQL Name, per the spec: the only shape an operation name may take.
 * Anything else is a client sending something that is not an operation name.
 *
 * The spec writes this as `[_A-Za-z][_0-9A-Za-z]*`; `\w` is exactly
 * `[A-Za-z0-9_]` in JavaScript without the `u` flag, so this is the same
 * pattern spelled the way the lint gate prefers.
 */
const GRAPHQL_NAME = /^[A-Za-z_]\w*$/;

/**
 * Ceiling on distinct `operation_name` label values (#1344).
 *
 * Set well above any plausible real operation count for this app — the frontend
 * has on the order of tens of named operations — so normal traffic never
 * reaches it and the cap is only ever hit by something anomalous.
 */
const MAX_OPERATION_NAMES = 200;

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

  /**
   * Operation names already admitted as label values, so the set of series this
   * process can create is bounded by `MAX_OPERATION_NAMES` rather than by what
   * callers send. Per-process and not shared: each service has its own ceiling.
   */
  private readonly seenOperationNames = new Set<string>();

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
    @InjectMetric('documents_embedded_total')
    private readonly documentsEmbedded: Gauge<string>,

    @InjectMetric('documents_total')
    private readonly documentsTotal: Gauge<string>,

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

    @InjectMetric('petition_retrieval_similarity')
    private readonly retrievalSimilarity: Histogram<string>,

    @InjectMetric('petition_retrieval_total')
    private readonly retrievalTotal: Counter<string>,

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
    const shared = {
      method,
      status_code: String(statusCode),
      service,
    };

    // The histogram deliberately carries no `route` — twelve series per
    // combination versus the counter's one, for a label nothing queries (#1344).
    this.httpRequestDuration.observe(shared, durationSeconds);
    this.httpRequestsTotal.inc({
      ...shared,
      route: this.normalizeRoute(route),
    });
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
    const shared = {
      operation_type: operationType,
      service,
    };

    // The histogram carries no `operation_name`: the name comes from the
    // client, so it is unbounded by nature, and twelve series per distinct
    // value is how a caller could evict a 512M Prometheus (#1344). The counter
    // keeps it, bounded.
    this.graphqlOperationDuration.observe(shared, durationSeconds);
    this.graphqlOperationsTotal.inc({
      ...shared,
      operation_name: this.boundOperationName(operationName),
      status,
    });
  }

  /**
   * Keep the client-supplied operation name usable as a metric label without
   * letting a caller choose how many series exist.
   *
   * Two independent limits, because each lets through what the other stops:
   *
   * 1. **Shape.** A GraphQL operation name is a Name per the spec —
   *    `/^[_A-Za-z][_0-9A-Za-z]*$/`. Anything else is a client sending
   *    something that is not an operation name, and is recorded as `invalid`
   *    rather than echoed into the label. This also keeps arbitrary caller text
   *    out of `/metrics`, which anything that scrapes it would then store.
   * 2. **Count.** Shape alone is no bound — `a1`, `a2`, `a3`... are all valid
   *    Names. So distinct values are capped; past the cap everything is
   *    `other`. The cap is above any plausible real operation count for this
   *    app, so normal traffic never reaches it.
   *
   * Deliberately a plain `Set` and not an LRU: an LRU would let a caller churn
   * the window and keep minting series as old ones fall out, which is the thing
   * being prevented. Once full, this stops admitting new names until restart.
   * The cost is that a genuinely new operation added after the cap is reached
   * reports as `other` until the next deploy — acceptable, and visible, because
   * `other` appearing at all is the signal that the cap was hit.
   */
  private boundOperationName(operationName: string): string {
    if (!operationName) return 'anonymous';
    if (!GRAPHQL_NAME.test(operationName)) return 'invalid';
    if (this.seenOperationNames.has(operationName)) return operationName;
    if (this.seenOperationNames.size >= MAX_OPERATION_NAMES) return 'other';

    this.seenOperationNames.add(operationName);
    return operationName;
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
   * Record a petition retrieval outcome (#1074).
   *
   * Records ids-free aggregates only — a score and an outcome label, never the
   * matched measure and never any document text.
   *
   * This exists because MIN_VERIFIED_SIMILARITY was first set by judgement at
   * 0.82 and measurement put the correct matches at 0.545 and 0.586: the
   * threshold would have verified nothing, ever, and nothing would have said
   * so. The histogram is how that gets noticed next time.
   */
  /**
   * Publish how much of the document corpus is actually searchable (#1220).
   *
   * The failure this exists for is not an error — it is an ABSENCE, and
   * absences do not raise themselves. Production sat at 20 documents / 0
   * embedded for two weeks: every scan logged `Retrieval skipped ... below
   * 70`, the code behaved exactly as specified, and no aggregate anywhere said
   * the feature had never once produced a match.
   *
   * `documents_embedded_total` flat while `petition_retrieval_total{outcome=
   * "skipped_low_ocr_confidence"}` climbs is that condition, visible on a
   * dashboard on day one instead of reconstructable from logs on day fourteen.
   */
  recordDocumentEmbeddingCoverage(
    service: string,
    type: string,
    embedded: number,
    total: number,
  ): void {
    this.documentsEmbedded.set({ service, type }, embedded);
    this.documentsTotal.set({ service, type }, total);
  }

  recordPetitionRetrieval(
    service: string,
    outcome:
      | 'verified'
      | 'unverified'
      // A match was found but the similarity threshold does not belong to the
      // running embedding model, so no verification judgement is made (#1156).
      // Separate from 'unverified' on purpose: that is a verdict, this is the
      // absence of one, and conflating them hides a dark feature in a number
      // that looks like it is working.
      | 'uncalibrated'
      | 'skipped_low_ocr_confidence'
      | 'skipped_no_text'
      | 'skipped_empty_corpus'
      // Corpus embedded under a different model than the running one: a
      // migration in progress, distinct from an absent corpus (#1282).
      | 'skipped_model_space_mismatch'
      | 'failed',
    similarity?: number,
  ): void {
    this.retrievalTotal.inc({ service, outcome });
    if (similarity !== undefined) {
      this.retrievalSimilarity.observe(
        { service, verified: String(outcome === 'verified') },
        similarity,
      );
    }
  }

  /**
   * Record document analysis outcome
   * Duration is only observed on success.
   *
   * The skipped_* statuses are the non-petition classification gate
   * (#1057): a rising skip rate against real-user traffic is the early
   * signal that the classifier is rejecting genuine petitions.
   */
  recordAnalysis(
    service: string,
    documentType: string,
    status:
      | 'success'
      | 'failure'
      | 'skipped_not_a_petition'
      | 'skipped_unreadable',
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
