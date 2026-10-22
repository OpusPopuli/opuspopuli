import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  JOB_TRACE_KEY,
  traceContextOf,
  withTraceContext,
} from "../src/job-tracing";
import { withJobSpan, withPublishSpan } from "../src/job-tracing";

/**
 * M3 / D7: one trace covering the request, the queue hop, and the work.
 *
 * Exercised against a REAL propagator, tracer and context manager rather than
 * mocks — the whole claim is that two processes agree on a wire format, and a
 * mocked propagator would assert only that this file calls the functions it
 * calls.
 */
describe("BullMQ trace propagation (M3)", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
    propagation.disable();
  });

  beforeEach(() => exporter.reset());

  const spanNamed = (name: string): ReadableSpan | undefined =>
    exporter.getFinishedSpans().find((s) => s.name === name);

  it("carries a W3C traceparent in the job data", async () => {
    const tracer = trace.getTracer("test");
    let carried: unknown;

    await tracer.startActiveSpan("caller", async (span) => {
      carried = withTraceContext({ regionId: "ca", triggerSource: "manual" });
      span.end();
    });

    const data = carried as Record<string, Record<string, string>>;
    expect(data[JOB_TRACE_KEY]).toBeDefined();
    // `00-<32 hex trace id>-<16 hex span id>-<2 hex flags>`
    expect(data[JOB_TRACE_KEY].traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
    // The payload survives untouched beside it.
    expect(data.regionId).toBe("ca");
    expect(data.triggerSource).toBe("manual");
  });

  it("makes the job span a child of the enqueue, in one trace", async () => {
    // The property D7 is actually about.
    const tracer = trace.getTracer("test");
    let jobData: unknown;

    await tracer.startActiveSpan("graphql.syncRegionData", async (request) => {
      await withPublishSpan("region-sync", async () => {
        jobData = withTraceContext({ regionId: "ca" });
        return { id: "job-1" };
      });
      request.end();
    });

    await withJobSpan(
      "region-sync",
      { id: "job-1", data: jobData },
      async () => {
        // Work the handler does lands under the job span — this is what makes a
        // stage timing clickable through to the request that asked for it.
        await trace
          .getTracer("opuspopuli.pipeline")
          .startActiveSpan("pipeline.fetch", async (s) => s.end());
      },
    );

    const request = spanNamed("graphql.syncRegionData")!;
    const publish = spanNamed("region-sync publish")!;
    const process = spanNamed("region-sync process")!;
    const stage = spanNamed("pipeline.fetch")!;

    const traceId = request.spanContext().traceId;
    expect(publish.spanContext().traceId).toBe(traceId);
    expect(process.spanContext().traceId).toBe(traceId);
    expect(stage.spanContext().traceId).toBe(traceId);

    expect(publish.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    expect(process.parentSpanContext?.spanId).toBe(
      publish.spanContext().spanId,
    );
    expect(stage.parentSpanContext?.spanId).toBe(process.spanContext().spanId);
  });

  it("starts a fresh trace for a job that carries no context", async () => {
    // The cron path: BullMQ replays stored scheduler data on every firing, so
    // a carrier there would parent every nightly run to one dead upsert span.
    await withJobSpan(
      "region-sync",
      { id: "cron-1", data: { regionId: "ca" } },
      async () => undefined,
    );

    const process = spanNamed("region-sync process")!;
    expect(process).toBeDefined();
    expect(process.parentSpanContext).toBeUndefined();
  });

  it("adds nothing to job data when nothing is being traced", async () => {
    // Outside any span the propagator writes no headers; the payload must not
    // grow an empty `__otel: {}` that a reader has to explain.
    const data = withTraceContext({ regionId: "ca" });

    expect(data).toEqual({ regionId: "ca" });
    expect(JOB_TRACE_KEY in data).toBe(false);
  });

  it("survives a malformed carrier rather than failing the job", async () => {
    // Job data is whatever was in Redis, possibly written by an older build.
    for (const bad of [
      { [JOB_TRACE_KEY]: "not-an-object" },
      { [JOB_TRACE_KEY]: null },
      { [JOB_TRACE_KEY]: { traceparent: "garbage" } },
      null,
      undefined,
    ]) {
      expect(() => traceContextOf(bad)).not.toThrow();
      await expect(
        withJobSpan("region-sync", { id: "j", data: bad }, async () => "ok"),
      ).resolves.toBe("ok");
    }
  });

  it("records the attempt, so a flaky job reads as flaky not slow", async () => {
    await withJobSpan(
      "region-sync",
      { id: "j", attemptsMade: 2 },
      async () => undefined,
    );

    expect(
      spanNamed("region-sync process")!.attributes["messaging.bullmq.attempt"],
    ).toBe(3);
  });

  it("marks the span failed and rethrows", async () => {
    await expect(
      withJobSpan("region-sync", { id: "j" }, async () => {
        throw new Error("handler exploded");
      }),
    ).rejects.toThrow("handler exploded");

    const process = spanNamed("region-sync process")!;
    expect(process.status.code).toBe(SpanStatusCode.ERROR);
    expect(process.events.map((e) => e.name)).toContain("exception");
  });

  it("names the queue and system on both ends", async () => {
    let jobData: unknown;
    await withPublishSpan("llm-rerank", async () => {
      jobData = withTraceContext({});
      return null;
    });
    await withJobSpan(
      "llm-rerank",
      { id: "j", data: jobData },
      async () => undefined,
    );

    for (const name of ["llm-rerank publish", "llm-rerank process"]) {
      const s = spanNamed(name)!;
      expect(s.attributes["messaging.system"]).toBe("bullmq");
      expect(s.attributes["messaging.destination.name"]).toBe("llm-rerank");
    }
    // The enum, not its ordinal: PRODUCER is 3 and CONSUMER is 4, and I
    // had guessed 1 and 2 — which is exactly the kind of thing a magic
    // number hides and a named constant cannot.
    expect(spanNamed("llm-rerank publish")!.kind).toBe(SpanKind.PRODUCER);
    expect(spanNamed("llm-rerank process")!.kind).toBe(SpanKind.CONSUMER);
  });
  describe("when the propagator itself misbehaves", () => {
    /**
     * A propagator is replaceable, and a custom one is under no obligation to
     * be total. These tests are what make the try/catch in `withTraceContext`
     * and `traceContextOf` load-bearing rather than decorative — without
     * them, removing either guard passes the whole suite.
     */
    const hostile = {
      inject: () => {
        throw new Error("inject exploded");
      },
      extract: () => {
        throw new Error("extract exploded");
      },
      fields: () => [],
    };

    beforeEach(() => {
      // `disable()` first, and it is not optional: OTel's `registerGlobal`
      // REFUSES to overwrite an already-registered global and returns false,
      // so a bare `setGlobalPropagator` here silently left the real W3C
      // propagator in place. Both tests in this block passed that way —
      // for the wrong reason, proving nothing. Verified by reverting the
      // guards afterwards: they now fail, and before they did not.
      propagation.disable();
      expect(propagation.setGlobalPropagator(hostile)).toBe(true);
    });

    afterEach(() => {
      propagation.disable();
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    });

    it("enqueues untraced rather than failing when inject throws", async () => {
      const data = withTraceContext({ regionId: "ca" });

      expect(data).toEqual({ regionId: "ca" });
      expect(JOB_TRACE_KEY in data).toBe(false);
    });

    it("returns a usable context rather than throwing when extract throws", async () => {
      // Tested DIRECTLY on traceContextOf, not through withJobSpan. Going
      // through the caller proved nothing while withJobSpan had a guard of
      // its own: the mutation that deleted this one survived, because the
      // outer catch absorbed it. traceContextOf is exported API, so a direct
      // caller depends on it being total.
      expect(() =>
        traceContextOf({ [JOB_TRACE_KEY]: { traceparent: "x" } }),
      ).not.toThrow();
      expect(traceContextOf({ [JOB_TRACE_KEY]: {} })).toBeDefined();
    });

    it("runs the job untraced rather than failing when extract throws", async () => {
      await expect(
        withJobSpan(
          "region-sync",
          { id: "j", data: { [JOB_TRACE_KEY]: { traceparent: "x" } } },
          async () => "handled",
        ),
      ).resolves.toBe("handled");
    });
  });

  it("records a failed enqueue on the publish span and rethrows", async () => {
    // The enqueue can fail on its own — Redis down, a bad job option — and
    // the span has to say so rather than report a publish that never landed.
    await expect(
      withPublishSpan("region-sync", async () => {
        throw new Error("redis unreachable");
      }),
    ).rejects.toThrow("redis unreachable");

    const publish = spanNamed("region-sync publish")!;
    expect(publish.status.code).toBe(SpanStatusCode.ERROR);
    expect(publish.events.map((e) => e.name)).toContain("exception");
  });
});
