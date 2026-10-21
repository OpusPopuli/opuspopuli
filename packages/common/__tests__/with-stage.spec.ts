import type { MetricsObserver } from "../src/providers/metrics/types.js";
import { PipelineStage } from "../src/providers/metrics/types.js";
import { trace } from "@opentelemetry/api";
import { withStage } from "../src/utils/with-stage.js";

describe("withStage (M1)", () => {
  type Observed = [
    string,
    number,
    Record<string, string> | undefined,
    Record<string, string> | undefined,
  ];
  let observed: Observed[];
  let counted: [
    string,
    number | undefined,
    Record<string, string> | undefined,
  ][];
  let observer: MetricsObserver;

  beforeEach(() => {
    observed = [];
    counted = [];
    observer = {
      observe: (m, v, l, e) => observed.push([m, v, l, e]),
      increment: (m, v, l) => counted.push([m, v, l]),
    };
  });

  it("returns the callback's value untouched", async () => {
    const result = await withStage(
      PipelineStage.Llm,
      {},
      async () => ({ answer: 42 }),
      { observer },
    );

    expect(result).toEqual({ answer: 42 });
  });

  it("observes a duration against the stage", async () => {
    await withStage(PipelineStage.Fetch, {}, async () => undefined, {
      observer,
    });

    expect(observed).toHaveLength(1);
    const [metric, value, labels] = observed[0];
    expect(metric).toBe("pipeline_stage_duration_seconds");
    expect(value).toBeGreaterThanOrEqual(0);
    expect(labels).toEqual({ stage: "fetch" });
  });

  it("omits labels the caller could not know", async () => {
    // A guessed label is worse than an absent one: wrong in a way no query
    // can detect. `resilientFetch` does not know its caller's data type.
    await withStage(
      PipelineStage.Llm,
      { dataType: "bills", lane: "ingestion" },
      async () => undefined,
      { observer },
    );

    // toStrictEqual, not toEqual: toEqual treats `model: undefined` as
    // absent, and an undefined label value is exactly the bug — prom-client
    // renders it as the string "undefined" rather than omitting the label.
    expect(observed[0][2]).toStrictEqual({
      stage: "llm",
      data_type: "bills",
      lane: "ingestion",
    });
  });

  it("counts an item only when asked", async () => {
    await withStage(PipelineStage.DbWrite, {}, async () => undefined, {
      observer,
    });
    expect(counted).toHaveLength(0);

    await withStage(
      PipelineStage.DbWrite,
      { dataType: "civics" },
      async () => undefined,
      { observer, untrackedItem: { outcome: "updated" } },
    );

    expect(counted).toEqual([
      [
        "pipeline_items_total",
        1,
        { stage: "db_write", data_type: "civics", outcome: "updated" },
      ],
    ]);
  });

  it("rethrows, and still measures the failure", async () => {
    // A stage that takes 30s to time out is exactly what the timing panel is
    // for; dropping it makes a broken stage's p95 look healthy.
    const boom = new TypeError("nope");

    await expect(
      withStage(
        PipelineStage.Ocr,
        { dataType: "documents" },
        async () => {
          throw boom;
        },
        { observer, untrackedItem: { outcome: "created" } },
      ),
    ).rejects.toBe(boom);

    expect(observed).toHaveLength(1);
    expect(observed[0][2]).toEqual({ stage: "ocr", data_type: "documents" });
    // The caller's intended outcome is replaced by the real one.
    expect(counted).toEqual([
      [
        "pipeline_items_total",
        1,
        {
          stage: "ocr",
          data_type: "documents",
          outcome: "failed",
          reason: "type_error",
        },
      ],
    ]);
  });

  it("does not count a failed item when none was requested", async () => {
    await expect(
      withStage(
        PipelineStage.Fetch,
        {},
        async () => {
          throw new Error("x");
        },
        { observer },
      ),
    ).rejects.toThrow();

    expect(observed).toHaveLength(1);
    expect(counted).toHaveLength(0);
  });

  it("runs, and still returns, with no observer bound", async () => {
    // Instrumentation must never be why a sync fails.
    await expect(
      withStage(PipelineStage.Embed, {}, async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("sends no exemplar when no tracing SDK is registered", async () => {
    // The no-op tracer returns an all-zero trace id. Attaching it would hang
    // a dead exemplar off every bucket.
    await withStage(PipelineStage.Llm, {}, async () => undefined, {
      observer,
    });

    expect(observed[0][3]).toBeUndefined();
  });

  it("measures elapsed time, not zero", async () => {
    await withStage(
      PipelineStage.PdfParse,
      {},
      () => new Promise((resolve) => setTimeout(resolve, 25)),
      { observer },
    );

    expect(observed[0][1]).toBeGreaterThan(0.01);
  });
  it("attaches a real trace id as an exemplar when a tracer is registered", async () => {
    // The mutation this closes: replacing the exemplar argument with a literal
    // `undefined` left all nine tests green, because every one of them only
    // asserted the NEGATIVE (no exemplar without an SDK). The seam that
    // produces the trace id in production had no test at all.
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const span = {
      spanContext: () => ({
        traceId,
        spanId: "00f067aa0ba902b7",
        traceFlags: 1,
      }),
      setStatus: () => undefined,
      recordException: () => undefined,
      end: () => undefined,
    };
    const restore = trace.getTracer;
    (trace as unknown as { getTracer: unknown }).getTracer = () => ({
      startActiveSpan: (_name: string, fn: (s: typeof span) => unknown) =>
        fn(span),
    });

    try {
      await withStage(PipelineStage.Llm, {}, async () => undefined, {
        observer,
      });
    } finally {
      (trace as unknown as { getTracer: typeof restore }).getTracer = restore;
    }

    expect(observed[0][3]).toEqual({ trace_id: traceId });
  });

  it("clamps a failure reason to a label-safe slug", async () => {
    // `Error.name` reaches a Prometheus label. Before this it came through
    // `(error as Error)?.name`, which read `.name` off ANY thrown value —
    // including an object parsed from a third-party HTTP response, i.e. a
    // label value chosen by a remote server.
    await expect(
      withStage(
        PipelineStage.Fetch,
        {},
        async () => {
          throw new TypeError("x");
        },
        { observer, untrackedItem: { outcome: "failed" } },
      ),
    ).rejects.toThrow();

    expect(counted[0][2]).toEqual({
      stage: "fetch",
      outcome: "failed",
      reason: "type_error",
    });
  });

  it("refuses a non-Error thrown value as a label source", async () => {
    // A scraper or a parsed API payload can throw a plain object.
    await expect(
      withStage(
        PipelineStage.Fetch,
        {},
        async () => {
          throw { name: "a very long attacker chosen label value indeed" };
        },
        { observer, untrackedItem: { outcome: "failed" } },
      ),
    ).rejects.toBeDefined();

    expect(counted[0][2]?.reason).toBe("error");
  });

  it("replaces a prose reason with a bounded placeholder", async () => {
    // Call sites write prose for the log line; one series per distinct
    // sentence is how a 512M Prometheus dies (#1343, #1344).
    await withStage(PipelineStage.DbWrite, {}, async () => undefined, {
      observer,
      untrackedItem: {
        outcome: "skipped",
        reason: "skipped (empty over existing — row kept, now stale)",
      },
    });

    expect(counted[0][2]?.reason).toBe("unlabelled");
  });

  it("keeps a reason that is already a slug", async () => {
    await withStage(PipelineStage.DbWrite, {}, async () => undefined, {
      observer,
      untrackedItem: { outcome: "skipped", reason: "hash_unchanged" },
    });

    expect(counted[0][2]?.reason).toBe("hash_unchanged");
  });
});
