/**
 * Prompt Client Metrics
 *
 * Simple counter-based metrics for monitoring prompt client health.
 * Tracks cache hits, remote calls, fallbacks, and latency.
 */

/**
 * Snapshot of prompt client metrics.
 */
export interface PromptClientMetrics {
  /** Total requests made (all sources) */
  totalRequests: number;
  /** Requests served from cache */
  cacheHits: number;
  /** Requests sent to remote prompt service */
  remoteCalls: number;
  /** Requests that fell back to DB after remote failure */
  dbFallbacks: number;
  /** Requests that used hardcoded fallback templates */
  hardcodedFallbacks: number;
  /** Average remote call latency in ms (0 if no remote calls) */
  avgRemoteLatencyMs: number;
  /** Current circuit breaker state */
  circuitBreakerState: string;
  /** Cache hit rate (0–1) */
  cacheHitRate: number;
  /** Fallback rate (0–1) */
  fallbackRate: number;
}

/**
 * Accumulates prompt client metrics.
 */
export class MetricsCollector {
  private totalRequests = 0;
  private cacheHits = 0;
  private remoteCalls = 0;
  private dbFallbacks = 0;
  private hardcodedFallbacks = 0;
  private totalRemoteLatencyMs = 0;

  recordCacheHit(): void {
    this.totalRequests++;
    this.cacheHits++;
  }

  recordRemoteCall(latencyMs: number): void {
    this.totalRequests++;
    this.remoteCalls++;
    this.totalRemoteLatencyMs += latencyMs;
  }

  recordDbFallback(): void {
    this.totalRequests++;
    this.dbFallbacks++;
  }

  recordHardcodedFallback(): void {
    this.totalRequests++;
    this.hardcodedFallbacks++;
  }

  getMetrics(circuitBreakerState: string): PromptClientMetrics {
    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      remoteCalls: this.remoteCalls,
      dbFallbacks: this.dbFallbacks,
      hardcodedFallbacks: this.hardcodedFallbacks,
      avgRemoteLatencyMs:
        this.remoteCalls > 0
          ? Math.round(this.totalRemoteLatencyMs / this.remoteCalls)
          : 0,
      circuitBreakerState,
      cacheHitRate:
        this.totalRequests > 0 ? this.cacheHits / this.totalRequests : 0,
      fallbackRate:
        this.totalRequests > 0
          ? (this.dbFallbacks + this.hardcodedFallbacks) / this.totalRequests
          : 0,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.cacheHits = 0;
    this.remoteCalls = 0;
    this.dbFallbacks = 0;
    this.hardcodedFallbacks = 0;
    this.totalRemoteLatencyMs = 0;
  }
}
