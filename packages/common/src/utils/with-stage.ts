import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  type MetricsObserver,
  PipelineMetric,
  type PipelineStageName,
} from "../providers/metrics/types.js";

/**
 * Labels that say WHOSE work a stage was.
 *
 * All optional: a shared helper like `resilientFetch` does not know which
 * data type is calling it, and a guessed label is worse than an absent one —
 * wrong in a way no query can detect.
 */
export interface StageContext {
  /** `bills`, `civics`, `propositions`, `representatives`, … */
  dataType?: string;
  /** `analysis` or `ingestion`. */
  lane?: string;
  /** Resolved model name, where a stage ran one. */
  model?: string;
  /** Which machine did the work — present from the start for §7. */
  host?: string;
}

/**
 * The closed vocabulary of `pipeline_items_total`'s `outcome` label.
 *
 * A union rather than `string`, because this IS a Prometheus label and #1344
 * removed one for being reachable from untrusted input. Declaring the
 * replacement as `string` and writing the real values in a help text would be
 * the same defect one layer up: nothing would stop a future call site putting
 * a scraped title or a URL here, and the first one to do it is a cardinality
 * incident, not a compile error.
 */
export type StageItemOutcome = "created" | "updated" | "skipped" | "failed";

/** What happened to the item a stage was processing. */
export interface StageOutcome {
  outcome: StageItemOutcome;
  /**
   * Why, for `skipped` and `failed`: `hash_unchanged`, `timeout`, …
   *
   * Still `string`, because the useful reasons differ per data type and no
   * single union could hold them — so it is ENFORCED instead of typed:
   * {@link boundedReason} drops anything that is not a short slug. Free-text
   * prose must never reach a label.
   */
  reason?: string;
}

/**
 * A label-safe reason, or nothing.
 *
 * Prometheus has no notion of a too-expensive label, so the clamp has to live
 * at the boundary. Prose like `"skipped (empty over existing — row kept)"` is
 * one series per distinct sentence; a slug is one per CASE.
 */
export function boundedReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return REASON_SHAPE.test(reason) ? reason : UNBOUNDED_REASON;
}

/** Lower snake/kebab, ≤32 chars. Deliberately narrow. */
const REASON_SHAPE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Substituted for a reason that fails the shape check.
 *
 * Named rather than dropped: a reason that was rejected and a stage that had
 * none are different facts, and silently discarding the label would make the
 * rejection invisible exactly where someone is looking for it.
 */
export const UNBOUNDED_REASON = "unlabelled";

/**
 * `TypeError` → `type_error`, so a failure reason is label-shaped by
 * construction rather than by the discipline of whoever throws.
 *
 * Takes `unknown` and checks `instanceof` on purpose. The earlier
 * `(error as Error)?.name` read `.name` off ANY thrown value — including a
 * plain object parsed out of a third-party HTTP response, which is a label
 * value supplied by a remote server. The cast also contradicted its own
 * optional chain: if the assertion held, `?.` was dead; if `?.` was needed,
 * the assertion was false.
 */
function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return "error";
  const slug = error.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return REASON_SHAPE.test(slug) ? slug : "error";
}

export interface WithStageDeps {
  /** Where measurements go. Absent means span-only. */
  observer?: MetricsObserver;
  /**
   * Count one item against `pipeline_items_total` — for a path that has NO
   * `SyncPhaseTracker`.
   *
   * Named `untrackedItem` rather than `item` because the hazard is invisible
   * otherwise. The counter admits exactly one writer per item, and inside a
   * sync that writer is the tracker, which already owns per-item outcome
   * accounting. The two writers emit DIFFERENT label sets on the same
   * counter — the tracker sets `phase`, this sets `stage` — so they are
   * different series, and `sum(rate(pipeline_items_total[5m]))` quietly adds
   * both. One `untrackedItem` inside a sync therefore makes every throughput
   * number wrong with no error anywhere; the name is here to be read at the
   * call site by whoever is about to do it.
   *
   * Omit to measure duration only. Most stages run several times per item,
   * and counting at every stage would multiply the item count by the number
   * of stages.
   */
  untrackedItem?: StageOutcome;
}

/**
 * Time one pipeline stage, as a span AND a metric, from one place
 * (M1, `docs/plans/ingestion-resource-lanes.md` §2).
 *
 * One helper on purpose. A span and a histogram maintained separately drift —
 * someone adds a stage to one and not the other, and the dashboard's "where
 * does a sync's time go" panel quietly stops agreeing with the trace. Here
 * they cannot disagree: the same call emits both, and the span's trace id
 * becomes the histogram's exemplar, so a slow bucket is clickable through to
 * the trace that produced it.
 *
 * Adds no behaviour. The callback's result and its exceptions pass through
 * untouched; a failure is recorded on the span, counted when `untrackedItem`
 * is given, and rethrown. Instrumentation must never be why a sync fails,
 * which is why `observer` is optional.
 *
 * `@opentelemetry/api` is a real DEPENDENCY, not an optional peer, and the
 * distinction matters: "no SDK registered" is a documented runtime no-op, but
 * "package not resolvable" is a `MODULE_NOT_FOUND` at load time — and because
 * this module is re-exported from the package barrel, that would break
 * importing ANYTHING from `@opuspopuli/common`. As an optional peer it worked
 * only by accident, resolving through a devDependency that the images happen
 * to install because they do not prune; a move to `--prod` for image size
 * would have taken every service down at boot.
 *
 * Carrying it directly is safe here where it would not be for prom-client:
 * OTel registers on `Symbol.for('opentelemetry.js.api.1')`, a global keyed by
 * API major version, so several copies interoperate by design. prom-client's
 * default registry is module-scoped instead, which is exactly why metrics go
 * through {@link MetricsObserver} rather than being registered here.
 *
 * @param stage - Which resource this work used
 * @param context - Whose work it was; omit any label you cannot know
 * @param fn - The work. Timed from call to settle
 * @param deps - Observer, and optionally the item outcome to count
 * @returns Whatever `fn` returns
 */
export async function withStage<T>(
  stage: PipelineStageName,
  context: StageContext,
  fn: () => Promise<T>,
  deps: WithStageDeps = {},
): Promise<T> {
  const tracer = trace.getTracer("opuspopuli.pipeline");
  const labels = stageLabels(stage, context);

  return tracer.startActiveSpan(`pipeline.${stage}`, async (span) => {
    // Monotonic: a wall-clock delta can go negative across an NTP step, and a
    // negative observation lands in the lowest bucket rather than erroring.
    const started = process.hrtime.bigint();
    try {
      const result = await fn();
      record(span, started, labels, deps, deps.untrackedItem);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // A failure's duration is a measurement too: a stage that takes 30
      // seconds to time out is exactly what the timing panel is for, and
      // dropping it makes a broken stage's p95 look healthy.
      //
      // The COUNT, though, stays opt-in. A caller that omitted `item` did so
      // because it cannot label one — counting its failures anyway would give
      // that stage a series containing nothing but failures, so a failure-rate
      // query reads 100% and a success-rate query reads 0%, permanently. An
      // absent series is honest; a failures-only series is not.
      record(
        span,
        started,
        labels,
        deps,
        deps.untrackedItem && {
          outcome: "failed",
          reason: failureReason(error),
        },
      );
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error)?.message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** The `reason` label, clamped, or no label at all. */
function reasonLabel(reason: string | undefined): { reason?: string } {
  const bounded = boundedReason(reason);
  return bounded ? { reason: bounded } : {};
}

/** Drop absent labels — Prometheus has no concept of an unset label. */
function stageLabels(
  stage: PipelineStageName,
  context: StageContext,
): Record<string, string> {
  const labels: Record<string, string> = { stage };
  const optional: [string, string | undefined][] = [
    ["data_type", context.dataType],
    ["lane", context.lane],
    ["model", context.model],
    ["host", context.host],
  ];
  // Truthiness deliberately: `''` is dropped alongside `undefined`, because
  // an empty-string label is worse than an absent one — it renders as a blank
  // option in a dashboard variable rather than simply not existing.
  for (const [key, value] of optional) if (value) labels[key] = value;
  return labels;
}

function record(
  span: { spanContext(): { traceId: string } },
  startedAt: bigint,
  labels: Record<string, string>,
  deps: WithStageDeps,
  item: StageOutcome | undefined,
): void {
  const { observer } = deps;
  if (!observer) return;

  const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  const { traceId } = span.spanContext();

  observer.observe(
    PipelineMetric.StageDurationSeconds,
    seconds,
    labels,
    // An all-zero trace id means no SDK is registered, so there is nothing to
    // link to; sending it would hang a dead exemplar off every bucket.
    traceId && !/^0+$/.test(traceId) ? { trace_id: traceId } : undefined,
  );

  if (!item) return;
  // `stage` comes along so a failure is attributable to the resource that
  // failed — "db_write/timeout" and "fetch/timeout" are different incidents.
  // `model` and `host` deliberately do not: they multiply the series without
  // changing what the throughput panel can answer.
  observer.increment(PipelineMetric.ItemsTotal, 1, {
    stage: labels.stage,
    ...(labels.data_type ? { data_type: labels.data_type } : {}),
    outcome: item.outcome,
    ...reasonLabel(item.reason),
  });
}
