import "reflect-metadata";
import {
  laneQueueName,
  PromptTooLargeError,
  type GenerateResult,
  type ILLMProvider,
  type IGpuLaneDispatcher,
  type GpuLaneJob,
  type MetricsObserver,
} from "@opuspopuli/common";
import { withLaneQueue } from "../src/providers/lane-queue";
import { withLaneMetrics } from "../src/providers/lane-metrics";

/**
 * S7 — batch inference routed through the lane queue
 * (`docs/plans/S7-gpu-lane-queue.md`). The dispatcher itself, and the
 * global bound, are tested against real Redis in the backend, and so is the
 * DI wiring (LLMModule resolving a globally bound dispatcher); this pins the
 * seam: that `generate` reaches the dispatcher with everything a consumer
 * needs, and that nothing changes when no dispatcher is bound.
 */
describe("withLaneQueue (S7)", () => {
  const provider = {
    getName: () => "Ollama",
    getModelName: () => "nemotron",
    getModelDigest: () => Promise.resolve("sha256:abc"),
    generate: jest.fn().mockResolvedValue({ text: "direct" }),
    chat: jest.fn().mockResolvedValue({ text: "chat" }),
    generateStream: async function* () {
      yield "tok";
    },
    isAvailable: () => Promise.resolve(true),
  } as unknown as ILLMProvider & { generate: jest.Mock; chat: jest.Mock };

  const endpoint = { url: "http://ollama:11434", model: "nemotron" };

  beforeEach(() => jest.clearAllMocks());

  it("returns the provider untouched when no dispatcher is bound", () => {
    // Every API process: interactive inference must stay direct.
    expect(withLaneQueue(provider, undefined, "analysis", endpoint)).toBe(
      provider,
    );
    expect(withLaneQueue(provider, null, "analysis", endpoint)).toBe(provider);
  });

  it("sends generate to the dispatcher with everything a consumer needs", async () => {
    const result: GenerateResult = { text: "queued" };
    const dispatcher: IGpuLaneDispatcher = {
      register: jest.fn(),
      generate: jest.fn().mockResolvedValue(result),
    };
    const queued = withLaneQueue(provider, dispatcher, "ingestion", endpoint);

    await expect(
      queued.generate("PROMPT", { maxTokens: 50, think: false }),
    ).resolves.toBe(result);

    expect(dispatcher.generate).toHaveBeenCalledWith({
      lane: "ingestion",
      endpoint,
      prompt: "PROMPT",
      options: { maxTokens: 50, think: false },
    } satisfies GpuLaneJob);
    // Without this, this process's own consumer would refuse the job.
    expect(dispatcher.register).toHaveBeenCalledWith("ingestion", endpoint);
    // Not called directly as well — that would be two inferences.
    expect(provider.generate).not.toHaveBeenCalled();
  });

  // #1429: a typed error does not survive Redis, so the refusal has to
  // happen here, on the caller's side, or the caller sees an anonymous
  // failure and cannot tell "too large" from "the model broke".
  describe("refusing a prompt too large for the window (#1429)", () => {
    const sized = () => {
      const dispatcher: IGpuLaneDispatcher = {
        register: jest.fn(),
        generate: jest.fn().mockResolvedValue({ text: "queued" }),
      };
      const queued = withLaneQueue(provider, dispatcher, "analysis", {
        ...endpoint,
        contextTokens: 131072,
      });
      return { dispatcher, queued };
    };
    const refuse = { maxTokens: 2000, refuseIfPromptExceedsContext: true };

    it("refuses before queueing it", async () => {
      const { dispatcher, queued } = sized();

      await expect(
        queued.generate("r".repeat(449000), refuse),
      ).rejects.toBeInstanceOf(PromptTooLargeError);
      expect(dispatcher.generate).not.toHaveBeenCalled();
    });

    it("queues a prompt that fits", async () => {
      const { queued } = sized();

      await expect(
        queued.generate("r".repeat(448900), refuse),
      ).resolves.toEqual({ text: "queued" });
    });

    it("reaches the caller typed through the metrics wrapper, as built in production", async () => {
      // buildLane wraps the queue in withLaneMetrics; the bills sync's
      // instanceof check depends on the error surviving both.
      const { dispatcher, queued } = sized();
      const observer: MetricsObserver = {
        observe: jest.fn(),
        increment: jest.fn(),
      };
      const built = withLaneMetrics(queued, "analysis", observer);

      await expect(
        built.generate("r".repeat(449000), refuse),
      ).rejects.toBeInstanceOf(PromptTooLargeError);
      expect(dispatcher.generate).not.toHaveBeenCalled();
    });
  });

  it("passes chat through, which no production caller uses", async () => {
    const dispatcher = { register: jest.fn(), generate: jest.fn() };
    const queued = withLaneQueue(provider, dispatcher, "analysis", endpoint);

    await queued.chat([{ role: "user", content: "hi" }]);

    expect(provider.chat).toHaveBeenCalled();
    expect(dispatcher.generate).not.toHaveBeenCalled();
  });
});

describe("laneQueueName (S7)", () => {
  it("names one queue per endpoint, shared by lanes on one host", () => {
    expect(laneQueueName("http://host.docker.internal:11434")).toBe(
      "gpu-lane-host.docker.internal-11434",
    );
    expect(laneQueueName("http://HOST.docker.internal.:11434/")).toBe(
      "gpu-lane-host.docker.internal-11434",
    );
    expect(laneQueueName("https://gpu.example")).toBe(
      "gpu-lane-gpu.example-443",
    );
    expect(laneQueueName("not a url")).toBe("gpu-lane-unknown-");
  });
});
