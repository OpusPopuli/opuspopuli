import { MetricsCollector } from "../src/metrics.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it("should start with zero counts", () => {
    const metrics = collector.getMetrics("closed");
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.cacheHits).toBe(0);
    expect(metrics.remoteCalls).toBe(0);
    expect(metrics.dbFallbacks).toBe(0);
    expect(metrics.hardcodedFallbacks).toBe(0);
    expect(metrics.avgRemoteLatencyMs).toBe(0);
    expect(metrics.cacheHitRate).toBe(0);
    expect(metrics.fallbackRate).toBe(0);
  });

  it("should record cache hits", () => {
    collector.recordCacheHit();
    collector.recordCacheHit();
    const metrics = collector.getMetrics("closed");
    expect(metrics.cacheHits).toBe(2);
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.cacheHitRate).toBe(1);
  });

  it("should record remote calls with latency", () => {
    collector.recordRemoteCall(100);
    collector.recordRemoteCall(200);
    const metrics = collector.getMetrics("closed");
    expect(metrics.remoteCalls).toBe(2);
    expect(metrics.avgRemoteLatencyMs).toBe(150);
  });

  it("should record DB fallbacks", () => {
    collector.recordDbFallback();
    collector.recordDbFallback();
    collector.recordDbFallback();
    const metrics = collector.getMetrics("closed");
    expect(metrics.dbFallbacks).toBe(3);
    expect(metrics.totalRequests).toBe(3);
    expect(metrics.fallbackRate).toBe(1);
  });

  it("should record hardcoded fallbacks", () => {
    collector.recordHardcodedFallback();
    const metrics = collector.getMetrics("closed");
    expect(metrics.hardcodedFallbacks).toBe(1);
    expect(metrics.fallbackRate).toBe(1);
  });

  it("should calculate combined fallback rate", () => {
    collector.recordRemoteCall(50);
    collector.recordDbFallback();
    collector.recordHardcodedFallback();
    const metrics = collector.getMetrics("closed");
    expect(metrics.totalRequests).toBe(3);
    expect(metrics.fallbackRate).toBeCloseTo(2 / 3);
  });

  it("should pass through circuit breaker state", () => {
    const metrics = collector.getMetrics("open");
    expect(metrics.circuitBreakerState).toBe("open");
  });

  it("should reset all counters to zero", () => {
    collector.recordCacheHit();
    collector.recordRemoteCall(100);
    collector.recordDbFallback();
    collector.recordHardcodedFallback();

    collector.reset();

    const metrics = collector.getMetrics("closed");
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.cacheHits).toBe(0);
    expect(metrics.remoteCalls).toBe(0);
    expect(metrics.dbFallbacks).toBe(0);
    expect(metrics.hardcodedFallbacks).toBe(0);
    expect(metrics.avgRemoteLatencyMs).toBe(0);
    expect(metrics.cacheHitRate).toBe(0);
    expect(metrics.fallbackRate).toBe(0);
  });
});
