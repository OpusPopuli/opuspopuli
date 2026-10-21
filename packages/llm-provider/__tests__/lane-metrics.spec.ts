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

  it("observes each reported phase with the lane and model", async () => {
    const wrapped = withLaneMetrics(
      stub({ phases: { loadSeconds: 0, prefillSeconds: 4, decodeSeconds: 1 } }),
      "ingestion",
      observer,
    );

    await wrapped.generate("p");

    expect(observed).toEqual([
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

    expect(observed.map(([, , l]) => l?.phase)).toEqual(["decode"]);
  });

  it("emits a zero phase, which is a real measurement", async () => {
    const wrapped = withLaneMetrics(
      stub({ phases: { loadSeconds: 0 } }),
      "analysis",
      observer,
    );

    await wrapped.generate("p");

    expect(observed).toHaveLength(1);
    expect(observed[0][1]).toBe(0);
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

    expect(observed).toHaveLength(1);
    expect(counted).toHaveLength(1);
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
