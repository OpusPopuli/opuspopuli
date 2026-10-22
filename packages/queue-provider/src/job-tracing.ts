import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";

/**
 * Where the W3C trace context rides inside a job's data (D7,
 * `docs/plans/ingestion-resource-lanes.md` M3).
 *
 * A reserved, namespaced key rather than a field on each job's own type: the
 * queue carries six unrelated payload shapes and this must not become part of
 * any of them. Every processor destructures the fields it wants, so an extra
 * key is inert — verified across all four processors before choosing this.
 */
export const JOB_TRACE_KEY = "__otel";

/** The W3C headers, exactly as `traceparent`/`tracestate` are defined. */
export type TraceCarrier = Record<string, string>;

const TRACER_NAME = "opuspopuli.queue";

/**
 * Copy the active trace context into a job's data.
 *
 * Returns the data UNCHANGED when there is nothing to propagate — no tracing
 * SDK registered, or no active span — so a job's payload never grows an empty
 * `__otel: {}` that readers have to explain. Absent means "not traced", which
 * is the truth.
 *
 * Never throws: a job that cannot be traced must still be enqueued.
 */
export function withTraceContext<T>(data: T): T {
  try {
    const carrier: TraceCarrier = {};
    propagation.inject(context.active(), carrier);
    if (Object.keys(carrier).length === 0) return data;
    return { ...data, [JOB_TRACE_KEY]: carrier };
  } catch {
    return data;
  }
}

/**
 * The context a job was enqueued in, or the current one if it carries none.
 *
 * A job with no carrier starts a fresh trace rather than attaching to whatever
 * the worker happened to be doing — which is correct for the cron path, where
 * BullMQ replays stored scheduler data on every firing (see
 * {@link withTraceContext}'s deliberate absence from `upsertScheduler`).
 */
export function traceContextOf(data: unknown): Context {
  try {
    const carrier = (data as Record<string, unknown> | null | undefined)?.[
      JOB_TRACE_KEY
    ];
    // No shape check on the carrier, deliberately. `extract` is defined to
    // tolerate a junk carrier — a string, a number, an array, `undefined` all
    // return the context unchanged with no span — so a guard here would be a
    // branch no test could ever distinguish. Verified against the W3C
    // propagator before removing it: every one of those inputs came back with
    // no span context and no throw.
    //
    // The try/catch stays, because a propagator is replaceable and a custom
    // one is under no such obligation.
    return propagation.extract(context.active(), carrier as TraceCarrier);
  } catch {
    return context.active();
  }
}

/** Attributes shared by both ends, named per the messaging conventions. */
function messagingAttributes(
  queueName: string,
  operation: "publish" | "process",
): Record<string, string> {
  return {
    "messaging.system": "bullmq",
    "messaging.destination.name": queueName,
    "messaging.operation": operation,
  };
}

/**
 * Run an enqueue inside a short producer span, with the context injected.
 *
 * The span is what makes the queue hop VISIBLE in the trace: without it the
 * job's span attaches straight to the GraphQL resolver and the handoff is
 * invisible — which is the thing D7 exists to show.
 */
export async function withPublishSpan<T>(
  queueName: string,
  fn: () => Promise<T>,
  onSpan?: (span: Span, result: T) => void,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    `${queueName} publish`,
    {
      kind: SpanKind.PRODUCER,
      attributes: messagingAttributes(queueName, "publish"),
    },
    async (span) => {
      try {
        const result = await fn();
        onSpan?.(span, result);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error)?.message,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Run a job handler as a CHILD of the span that enqueued it (D7).
 *
 * A child rather than a link, deliberately: the stated goal is one trace
 * covering the request, the queue and the work the job does — including every
 * `withStage()` span the sync opens, which become grandchildren here. A link
 * would leave two traces that a reader has to join by hand.
 *
 * Instrumentation must never be why a job fails, so a tracing failure falls
 * back to running the handler untraced rather than propagating.
 */
export async function withJobSpan<T>(
  queueName: string,
  job: { id?: string | number; data?: unknown; attemptsMade?: number },
  fn: () => Promise<T>,
): Promise<T> {
  // No try/catch around this: `traceContextOf` is total — it catches its own
  // propagator failures and falls back to the active context. A second guard
  // here was dead code, and worse, it made the FIRST one untestable: removing
  // the inner guard changed no behaviour because this one absorbed it, so the
  // mutation survived and the test proved nothing.
  const parent = traceContextOf(job.data);

  const tracer = trace.getTracer(TRACER_NAME);
  return context.with(parent, () =>
    tracer.startActiveSpan(
      `${queueName} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          ...messagingAttributes(queueName, "process"),
          ...(job.id !== undefined
            ? { "messaging.message.id": String(job.id) }
            : {}),
          // Retries are separate spans under the same parent, so a job that
          // succeeded on attempt 3 reads as three spans rather than one slow
          // one — which is the difference between "slow" and "flaky".
          "messaging.bullmq.attempt": (job.attemptsMade ?? 0) + 1,
        },
      },
      async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error)?.message,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    ),
  );
}
