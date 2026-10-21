/**
 * The seam between code that MEASURES and code that REGISTERS metrics
 * (`docs/plans/ingestion-resource-lanes.md` §2).
 *
 * A token-injected interface, like every other provider here: the metrics
 * backend is an external dependency, and the implementation is swapped by
 * binding a different provider rather than by changing a call site.
 *
 * ── Why the indirection ─────────────────────────────────────────────────────
 *
 * The plan puts its instrumentation INSIDE packages — `withStage()` in this
 * one, LLM phase timings in `@opuspopuli/llm-provider` — while `prom-client`
 * is declared only in `apps/backend`. Three ways out, of which this is the
 * chosen one (owner decision, 2026-10-21):
 *
 *  1. Add `prom-client` to each package. Rejected: pnpm resolves per
 *     workspace, so two workspaces share one module instance — and so one
 *     default registry — only because they happen to resolve the same
 *     version. Let those drift and metrics register on a registry nothing
 *     serves, vanishing with no error. That is the same class of silent
 *     failure that left three Grafana dashboards reading "Datasource not
 *     found" and two Node Health panels empty against a drop rule.
 *  2. Emit only from the backend. Rejected: `withStage()` wraps call sites
 *     inside packages (`resilient-fetch.ts`, `extraction.provider.ts`,
 *     `pdf-extractor.ts`) that the backend cannot reach.
 *  3. **This.** Packages depend on an interface; the backend owns
 *     registration. Nothing in a package can mis-register, because nothing
 *     in a package registers.
 *
 * Deliberately tiny. Every metric in the plan — `pipeline_stage_duration_
 * seconds`, `pipeline_items_total`, `lane_wait_seconds`, the fetch and
 * lazy-analysis families — goes through these two methods, so this must not
 * grow a method per metric.
 */
export interface MetricsObserver {
  /**
   * Record a value into a histogram.
   *
   * @param metric - Metric name, from the constants in this module
   * @param value - The observation in the metric's own unit — seconds for
   *   anything named `_seconds`
   * @param labels - Label values; must match the metric's declared label set
   */
  observe(metric: string, value: number, labels?: Record<string, string>): void;

  /**
   * Add to a counter.
   *
   * @param metric - Metric name, from the constants in this module
   * @param value - Amount to add; defaults to 1
   * @param labels - Label values; must match the metric's declared label set
   */
  increment(
    metric: string,
    value?: number,
    labels?: Record<string, string>,
  ): void;
}

/**
 * DI token for the observer.
 *
 * Injected `{ optional: true }` everywhere, so a service with nothing bound
 * behaves exactly as it did before — see {@link NOOP_METRICS_OBSERVER}.
 */
export const METRICS_OBSERVER = "METRICS_OBSERVER";

/**
 * Discards everything.
 *
 * The default, so instrumentation is never load-bearing: a worker that binds
 * no observer must still run. Measurement that can take down the thing it
 * measures is worse than no measurement.
 */
export const NOOP_METRICS_OBSERVER: MetricsObserver = {
  observe: () => undefined,
  increment: () => undefined,
};

/**
 * Metric names as constants, so a call site cannot invent one.
 *
 * Names and label sets are the contract in
 * `docs/plans/ingestion-resource-lanes.md` §3. A typo in a hand-written
 * metric name does not fail — it produces a metric nobody queries and a
 * panel reading "No data", which is indistinguishable from an idle system.
 */
export const LlmMetric = {
  /** Histogram, seconds. Labels: `lane`, `model`, `phase`. */
  RequestDurationSeconds: "llm_request_duration_seconds",
  /** Counter. Labels: `lane`, `model`, `direction`. */
  TokensTotal: "llm_tokens_total",
} as const;

/** `phase` label values for {@link LlmMetric.RequestDurationSeconds}. */
export const LlmPhase = {
  Load: "load",
  Prefill: "prefill",
  Decode: "decode",
} as const;

/** `direction` label values for {@link LlmMetric.TokensTotal}. */
export const LlmTokenDirection = {
  In: "in",
  Out: "out",
} as const;
