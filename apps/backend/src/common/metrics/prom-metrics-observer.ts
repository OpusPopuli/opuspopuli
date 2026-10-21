import { Injectable, Logger, Optional } from '@nestjs/common';
import type { MetricsObserver } from '@opuspopuli/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';

/**
 * The prom-client side of the metrics seam (M2,
 * `docs/plans/ingestion-resource-lanes.md` §2).
 *
 * `MetricsObserver` lets a package measure without depending on a metrics
 * library — see that interface for why. This is the one implementation, and
 * it lives here because this is the only workspace that declares
 * `prom-client` and the only one whose `/metrics` endpoint is scraped.
 *
 * Metrics are DECLARED in `metrics.module.ts` alongside every other metric
 * and injected, not created here. Creating them on first use would put a
 * second registration path beside the module's, and a metric registered
 * twice throws while a metric registered on the wrong registry silently
 * never appears.
 *
 * Unknown metric names are dropped with a warning rather than thrown. An
 * observation is not worth an exception on a request path — but a silent
 * drop is how an instrumented system reads as idle, so it is said out loud.
 */
@Injectable()
export class PromMetricsObserver implements MetricsObserver {
  private readonly logger = new Logger(PromMetricsObserver.name);

  /** Warned-about names, so one bad call site does not flood the log. */
  private readonly unknown = new Set<string>();

  private readonly histograms: Map<string, Histogram<string>>;
  private readonly counters: Map<string, Counter<string>>;

  constructor(
    @Optional()
    @InjectMetric('llm_request_duration_seconds')
    llmRequestDuration?: Histogram<string>,
    @Optional()
    @InjectMetric('llm_tokens_total')
    llmTokens?: Counter<string>,
  ) {
    this.histograms = new Map(
      llmRequestDuration
        ? [['llm_request_duration_seconds', llmRequestDuration]]
        : [],
    );
    this.counters = new Map(llmTokens ? [['llm_tokens_total', llmTokens]] : []);
  }

  observe(
    metric: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    const histogram = this.histograms.get(metric);
    if (!histogram) return this.warnOnce(metric, 'histogram');
    histogram.observe(labels, value);
  }

  increment(
    metric: string,
    value = 1,
    labels: Record<string, string> = {},
  ): void {
    const counter = this.counters.get(metric);
    if (!counter) return this.warnOnce(metric, 'counter');
    counter.inc(labels, value);
  }

  private warnOnce(metric: string, kind: string): void {
    if (this.unknown.has(metric)) return;
    this.unknown.add(metric);
    this.logger.warn(
      `No ${kind} registered for "${metric}" — observations are being ` +
        `discarded. Declare it in metrics.module.ts and inject it here.`,
    );
  }
}
