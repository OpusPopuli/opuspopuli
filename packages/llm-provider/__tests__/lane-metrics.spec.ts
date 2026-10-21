import "reflect-metadata";
import type {
  GenerateResult,
  ILLMProvider,
  MetricsObserver,
} from "@opuspopuli/common";
import { withLaneMetrics } from "../src/providers/lane-metrics";

describe("withLaneMetrics (M2)", () => {
  const observed: [string, number, Record<string, string> | undefined][] = [];
  const counted: [
    string,
    number | undefined,
    Record<string, string> | undefined,
  ][] = [];

  const observer: MetricsObserver = {
    observe: (m, v, l) => observed.push([m, v, l]),
    increment: (m, v, l) => counted.push([m, v, l]),
  };

  const stub = (result: Partial<GenerateResult>): ILLMProvider =>
    ({
      getName: () => "Ollama",
      getModelName: () => "nemotron-3.5-lightning:30b-a3b",
      getModelDigest: () => Promise.resolve("sha256:abc"),
      generate: () => Promise.resolve({ text: "ok", ...result }),
      chat: () => Promise.resolve({ text: "ok", ...result }),
      generateStream: async function* () {
        yield "tok";
      },
      isAvailable: () => Promise.resolve(true),
    }) as unknown as ILLMProvider;

  beforeEach(() => {
    observed.length = 0;
    counted.length = 0;
  });

  /**
   * Observations of one metric.
   *
   * The phase tests below assert an exact list, and a wrapped call now also
   * observes the `llm` pipeline STAGE (M1) — a different measurement with its
   * own test. Scoping each assertion to its metric keeps both exact rather
   * than loosening either into a `toContainEqual`.
   */
  const only = (metric: string) => observed.filter(([name]) => name === metric);
  const LLM_PHASES = "llm_request_duration_seconds";
  const STAGE = "pipeline_stage_duration_seconds";

  it("observes each reported phase with the lane and model", async () => {
    const wrapped = withLaneMetrics(
      stub({ phases: { loadSeconds: 0, prefillSeconds: 4, decodeSeconds: 1 } }),
      "ingestion",
      observer,
    );

    await wrapped.generate("p");

    expect(only(LLM_PHASES)).toEqual([
      [
        "llm_request_duration_seconds",
        0,
        {
          lane: "ingestion",
          model: "nemotron-3.5-lightning:30b-a3b",
          phase: "load",
        },
      ],
      [
        "llm_request_duration_seconds",
        4,
        {
          lane: "ingestion",
          model: "nemotron-3.5-lightning:30b-a3b",
          phase: "prefill",
        },
      ],
      [
        "llm_request_duration_seconds",
        1,
        {
          lane: "ingestion",
          model: "nemotron-3.5-lightning:30b-a3b",
          phase: "decode",
        },
      ],
    ]);
  });

  it("does not emit a phase the provider did not report", async () => {
    // Emitting 0 for an absent phase would read as "the GPU did this
    // instantly" and drag every average down.
    const wrapped = withLaneMetrics(
      stub({ phases: { decodeSeconds: 2 } }),
      "analysis",
      observer,
    );

    await wrapped.generate("p");

    // `only(LLM_PHASES)`, not raw `observed`: a wrapped call now also observes
    // the llm STAGE, so the raw array is ["decode", undefined] and this passed
    // only because Jest treats a trailing undefined as equal to absent.
    expect(only(LLM_PHASES).map(([, , l]) => l?.phase)).toEqual(["decode"]);
  });

  it("emits a zero phase, which is a real measurement", async () => {
    const wrapped = withLaneMetrics(
      stub({ phases: { loadSeconds: 0 } }),
      "analysis",
      observer,
    );

    await wrapped.generate("p");

    expect(only(LLM_PHASES)).toHaveLength(1);
    expect(only(LLM_PHASES)[0][1]).toBe(0);
  });

  it("counts tokens by direction", async () => {
    const wrapped = withLaneMetrics(
      stub({ tokensIn: 1200, tokensOut: 48 }),
      "analysis",
      observer,
    );

    await wrapped.generate("p");

    expect(counted).toEqual([
      [
        "llm_tokens_total",
        1200,
        {
          lane: "analysis",
          model: "nemotron-3.5-lightning:30b-a3b",
          direction: "in",
        },
      ],
      [
        "llm_tokens_total",
        48,
        {
          lane: "analysis",
          model: "nemotron-3.5-lightning:30b-a3b",
          direction: "out",
        },
      ],
    ]);
  });

  it("measures the chat path too", async () => {
    const wrapped = withLaneMetrics(
      stub({ phases: { decodeSeconds: 3 }, tokensOut: 10 }),
      "analysis",
      observer,
    );

    await wrapped.chat([{ role: "user", content: "hi" }]);

    expect(only(LLM_PHASES)).toHaveLength(1);
    expect(only(STAGE)).toHaveLength(1);
    expect(counted).toHaveLength(1);
  });

  it("also times the call as the `llm` pipeline stage", async () => {
    // Not a duplicate of the phase timings: these are the GPU's work, the
    // stage is the caller's wall clock, and the difference is queue wait plus
    // the HTTP round trip. §3 row 2 needs a sync's stages to sum to its
    // duration, which the phase metrics alone cannot do.
    const wrapped = withLaneMetrics(
      stub({ phases: { decodeSeconds: 3 } }),
      "ingestion",
      observer,
    );

    await wrapped.generate("p");

    const stage = only(STAGE);
    expect(stage).toHaveLength(1);
    expect(stage[0][2]).toStrictEqual({
      stage: "llm",
      lane: "ingestion",
      model: "nemotron-3.5-lightning:30b-a3b",
    });
    expect(stage[0][1]).toBeGreaterThanOrEqual(0);
  });

  it("times a failed call and lets the error through", async () => {
    // A model that times out after 30s is exactly what row 2 is for.
    const failing = {
      ...stub({}),
      generate: () => Promise.reject(new Error("ollama down")),
    } as unknown as ILLMProvider;
    const wrapped = withLaneMetrics(failing, "analysis", observer);

    await expect(wrapped.generate("p")).rejects.toThrow("ollama down");

    expect(only(STAGE)).toHaveLength(1);
    // No phase timings: the provider never returned a result to read them
    // from, and a zero would read as "the GPU did this instantly".
    expect(only(LLM_PHASES)).toHaveLength(0);
  });

  it("counts no items — one LLM call is not one item", async () => {
    // Several generators make more than one call per row. Counting here
    // would multiply the item count by however many each makes.
    const wrapped = withLaneMetrics(
      stub({ phases: { decodeSeconds: 1 } }),
      "analysis",
      observer,
    );

    await wrapped.generate("p");

    expect(counted.filter(([m]) => m === "pipeline_items_total")).toEqual([]);
  });

  it("returns the provider untouched when no observer is bound", async () => {
    const provider = stub({ phases: { decodeSeconds: 1 } });

    const wrapped = withLaneMetrics(provider, "analysis", undefined);

    expect(wrapped).toBe(provider);
  });

  it("delegates every member of ILLMProvider", async () => {
    // The first version spread `{ ...provider }` and then listed five of
    // seven members. A spread copies no prototype methods, so
    // `generateStream` and `isAvailable` were undefined at runtime while tsc
    // stayed happy — the spread is TYPED as a complete provider.
    const wrapped = withLaneMetrics(stub({}), "analysis", observer);

    expect(wrapped.getName()).toBe("Ollama");
    expect(wrapped.getModelName()).toBe("nemotron-3.5-lightning:30b-a3b");
    await expect(wrapped.getModelDigest()).resolves.toBe("sha256:abc");
    await expect(wrapped.isAvailable()).resolves.toBe(true);

    const chunks: string[] = [];
    for await (const c of wrapped.generateStream("p")) chunks.push(c);
    expect(chunks).toEqual(["tok"]);
  });

  it("passes the result through unchanged", async () => {
    const wrapped = withLaneMetrics(
      stub({ tokensIn: 5, phases: { decodeSeconds: 1 } }),
      "analysis",
      observer,
    );

    const result = await wrapped.generate("p");

    expect(result.text).toBe("ok");
    expect(result.tokensIn).toBe(5);
  });
});
