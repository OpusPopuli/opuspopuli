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

  /**
   * Warned-about `metric:kind` pairs, so one bad call site does not flood the
   * log — but a SECOND, different failure on the same metric still speaks.
   *
   * Keyed on the pair rather than the name because keying on the name alone
   * silenced the wrong thing: a histogram that first warned about a missing
   * `enableExemplars` flag then stayed permanently quiet about prom-client
   * rejecting its observations. "A dropped measurement is how an instrumented
   * system comes to read as idle" argues against suppressing a different
   * fault.
   */
  private readonly warned = new Set<string>();

  private readonly histograms: Map<string, Histogram<string>>;
  private readonly counters: Map<string, Counter<string>>;

  constructor(
    @Optional()
    @InjectMetric('llm_request_duration_seconds')
    llmRequestDuration?: Histogram<string>,
    @Optional()
    @InjectMetric('llm_tokens_total')
    llmTokens?: Counter<string>,
    @Optional()
    @InjectMetric('pipeline_stage_duration_seconds')
    pipelineStageDuration?: Histogram<string>,
    @Optional()
    @InjectMetric('pipeline_items_total')
    pipelineItems?: Counter<string>,
    @Optional()
    @InjectMetric('pipeline_phase_aborted_total')
    pipelineAborts?: Counter<string>,
    @Optional()
    @InjectMetric('pipeline_rows_deleted_total')
    pipelineRowsDeleted?: Counter<string>,
  ) {
    this.histograms = asMap({
      llm_request_duration_seconds: llmRequestDuration,
      pipeline_stage_duration_seconds: pipelineStageDuration,
    });
    this.counters = asMap({
      llm_tokens_total: llmTokens,
      pipeline_items_total: pipelineItems,
      pipeline_phase_aborted_total: pipelineAborts,
      pipeline_rows_deleted_total: pipelineRowsDeleted,
    });
  }

  observe(
    metric: string,
    value: number,
    labels: Record<string, string> = {},
    exemplarLabels?: Record<string, string>,
  ): void {
    const histogram = this.histograms.get(metric);
    if (!histogram)
      return this.warnOnce(
        metric,
        'unregistered',
        'no histogram is registered — declare it in metrics.module.ts and ' +
          'inject it here',
      );

    // prom-client has two `observe` overloads and they are NOT
    // interchangeable: `enableExemplars` rebinds the method once, at
    // construction, so each histogram accepts exactly one of them for its
    // whole life.
    //
    //   - exemplars ON  → `observeWithExemplar({labels, value, exemplarLabels})`.
    //     Passing `(labels, value)` here destructures the LABEL OBJECT as the
    //     argument bag, so `value` comes out `undefined` and the observation
    //     silently never lands. That was a real bug in this file, caught by
    //     `metrics-openmetrics.spec.ts` asserting the rendered scrape: with no
    //     tracing SDK registered `withStage` attaches no exemplar, which is
    //     the common case, so it dropped nearly every pipeline measurement.
    //   - exemplars OFF → `observeWithoutExemplar(labels, value)`. The object
    //     form there throws `Added label "labels" is not included in initial
    //     labelset`, or records garbage on a metric that declares labels.
    //
    // So dispatch on how the METRIC was declared, never on whether this
    // caller happens to have an exemplar — a caller cannot know the former,
    // and an exemplar-less call to an exemplar-enabled histogram is normal.
    const hasExemplar =
      exemplarLabels !== undefined && Object.keys(exemplarLabels).length > 0;

    // Never throw from here: prom-client rejects an exemplar label set over
    // 128 chars with a RangeError, and an observation is not worth taking a
    // request path down.
    try {
      if (this.supportsExemplars(histogram, metric)) {
        // An empty set is prom-client's own no-op — `updateExemplar` returns
        // before touching the bucket — so the sample is recorded either way.
        histogram.observe({
          labels,
          value,
          exemplarLabels: hasExemplar ? exemplarLabels : {},
        });
      } else {
        histogram.observe(labels, value);
      }
    } catch (error) {
      this.warnOnce(
        metric,
        'rejected',
        `histogram rejected an observation (${describe(error)})`,
      );
    }
  }

  increment(
    metric: string,
    value = 1,
    labels: Record<string, string> = {},
  ): void {
    const counter = this.counters.get(metric);
    if (!counter)
      return this.warnOnce(
        metric,
        'unregistered',
        'no counter is registered — declare it in metrics.module.ts and ' +
          'inject it here',
      );
    try {
      counter.inc(labels, value);
    } catch (error) {
      this.warnOnce(
        metric,
        'rejected',
        `counter rejected an increment (${describe(error)})`,
      );
    }
  }

  /**
   * Whether this histogram was declared with `enableExemplars`.
   *
   * Read off the instance, which prom-client 15 sets in its constructor — but
   * NOT part of its published types, so a cast is unavoidable. The three
   * cases are deliberately distinct: `true` takes the exemplar overload,
   * `false` is a metric that simply does not carry exemplars, and `undefined`
   * means prom-client no longer exposes the flag. That last case still falls
   * back to the safe overload, but says so, because the alternative is every
   * exemplar silently disappearing after a dependency bump — with the panel
   * still drawing, just with nothing behind the dots.
   */
  private supportsExemplars(
    histogram: Histogram<string>,
    metric: string,
  ): boolean {
    const { enableExemplars } = histogram as Histogram<string> & {
      enableExemplars?: boolean;
    };
    if (typeof enableExemplars === 'boolean') return enableExemplars;

    this.warnOnce(
      metric,
      'exemplar-flag',
      'prom-client no longer reports enableExemplars on a histogram, so ' +
        'trace exemplars are being dropped — check its release notes',
    );
    return false;
  }

  /**
   * Say it once per metric. A dropped measurement is how an instrumented
   * system comes to read as idle, so it is never silent — but one bad call
   * site must not flood the log either.
   */
  private warnOnce(metric: string, kind: string, problem: string): void {
    const key = `${metric}:${kind}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(
      `Measurements for "${metric}" are being discarded: ${problem}.`,
    );
  }
}

/** Drop the metrics this service did not register, and key the rest by name. */
function asMap<T>(entries: Record<string, T | undefined>): Map<string, T> {
  return new Map(
    Object.entries(entries).filter((entry): entry is [string, T] =>
      Boolean(entry[1]),
    ),
  );
}

/**
 * An error's message without assuming it is an Error.
 *
 * Inside a catch whose stated job is "never throw from here", a bare
 * `(error as Error).message` is a second throw waiting on a thrown `null`.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
