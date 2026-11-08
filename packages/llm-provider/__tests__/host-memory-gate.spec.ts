import { Logger } from "@nestjs/common";
import {
  canonicalModel,
  createHostMemoryGate,
  headroomBytesFrom,
  resetSharedHostMemoryGate,
  sharedHostMemoryGate,
  type HostGateOutcome,
} from "../src/providers/host-memory-gate";

const GIB = 1024 ** 3;
const OLLAMA = "http://ollama:11434";
const PROBE = "http://host:11500/memory";
const MODEL = "big:30b";

interface Host {
  resident?: string[];
  /** size_vram per resident model, same order; 6 GiB when unset. */
  residentVram?: number[];
  /** What /api/tags lists; MODEL only when unset. */
  tags?: string[];
  size?: number;
  reclaimable?: number | "down" | "garbage";
  ollamaDown?: boolean;
}

/** A fake Ollama + probe, answering by URL. */
function fakeFetch(host: Host) {
  const fn = jest.fn(async (url: string): Promise<Response> => {
    const json = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body }) as Response;
    if (url.startsWith(OLLAMA) && host.ollamaDown) {
      throw new Error("ECONNREFUSED");
    }
    if (url === `${OLLAMA}/api/ps`) {
      return json({
        models: (host.resident ?? []).map((name, i) => ({
          name,
          size_vram: host.residentVram?.[i] ?? 6 * GIB,
        })),
      });
    }
    if (url === `${OLLAMA}/api/tags`) {
      return json({
        models: (host.tags ?? [MODEL]).map((name) => ({
          name,
          size: host.size ?? 24 * GIB,
        })),
      });
    }
    if (url === PROBE) {
      if (host.reclaimable === "down") throw new Error("ECONNREFUSED");
      if (host.reclaimable === "garbage") return json({ reclaimable: "lots" });
      return json({ reclaimableBytes: host.reclaimable });
    }
    throw new Error(`unexpected ${url}`);
  });
  return fn;
}

const gateFor = (
  host: Host,
  onOutcome?: jest.Mock,
  extra: { maxLoadedModels?: number; now?: () => number } = {},
) =>
  createHostMemoryGate({
    probeUrl: PROBE,
    headroomBytes: 4 * GIB,
    fetchFn: fakeFetch(host),
    onOutcome,
    ...extra,
  });

const outcome = async (host: Host): Promise<HostGateOutcome> =>
  (await gateFor(host).check(OLLAMA, MODEL)).outcome;

describe("host memory gate (#1434)", () => {
  it("lets a call through when the model is already loaded, without asking the probe", async () => {
    const fetchFn = fakeFetch({ resident: [MODEL], reclaimable: 0 });
    const gate = createHostMemoryGate({
      probeUrl: PROBE,
      headroomBytes: 4 * GIB,
      fetchFn,
    });
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("admitted");
    expect(fetchFn.mock.calls.map((c) => c[0])).not.toContain(PROBE);
  });

  it("loads only with room for the model plus the headroom", async () => {
    expect(await outcome({ reclaimable: 28 * GIB })).toBe("admitted");
    expect(await outcome({ reclaimable: 28 * GIB - 1 })).toBe("deferred");
    // The 2026-11-07 reading: 22.5 GiB free against a 23.7 GiB model.
    expect(await outcome({ size: 23.7 * GIB, reclaimable: 22.5 * GIB })).toBe(
      "deferred",
    );
  });

  it("counts what Ollama frees by evicting, once it is at its model limit", async () => {
    // One model loaded, one allowed: loading this one unloads that one, so
    // a swap is not refused for want of the memory it releases.
    expect(
      await outcome({
        resident: ["other:30b"],
        residentVram: [24 * GIB],
        reclaimable: 10 * GIB,
      }),
    ).toBe("admitted");
  });

  it("does not count a resident model Ollama is allowed to keep", async () => {
    const gate = gateFor(
      {
        resident: ["other:30b"],
        residentVram: [24 * GIB],
        reclaimable: 10 * GIB,
      },
      undefined,
      { maxLoadedModels: 2 },
    );
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("deferred");
  });

  it("holds back room for a load it let through that has not landed", async () => {
    let t = 0;
    const host: Host = { reclaimable: 40 * GIB, tags: [MODEL, "second:30b"] };
    // A limit of two keeps eviction out of it: only reservations are tested.
    const gate = gateFor(host, undefined, { now: () => t, maxLoadedModels: 2 });
    // 40 GiB is room for either 24 GiB model plus 4, not for both.
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("admitted");
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("deferred");
    // Once the first shows as loaded, and its grace has passed, its
    // reservation is released.
    host.resident = [MODEL];
    host.residentVram = [24 * GIB];
    host.reclaimable = 30 * GIB;
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("deferred");
    t += 6_000;
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("admitted");
    // And a reservation that never lands lapses.
    host.resident = [];
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("deferred");
    t += 121_000;
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("admitted");
  });

  it("keeps a landed load reserved while a reading from before it may be cached", async () => {
    let t = 0;
    const host: Host = { reclaimable: 40 * GIB, tags: [MODEL, "second:30b"] };
    const gate = gateFor(host, undefined, { now: () => t, maxLoadedModels: 2 });
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("admitted");
    // It lands, but the probe still answers with the reading from before.
    host.resident = [MODEL];
    host.residentVram = [24 * GIB];
    t += 1_000;
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("deferred");
    // Past the grace, a fresh reading decides.
    t += 6_000;
    host.reclaimable = 30 * GIB;
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("admitted");
  });

  it("gives a reservation back when its call fails", async () => {
    const host: Host = { reclaimable: 40 * GIB, tags: [MODEL, "second:30b"] };
    const gate = gateFor(host, undefined, { maxLoadedModels: 2 });
    await gate.check(OLLAMA, MODEL);
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("deferred");
    gate.release(OLLAMA, MODEL);
    expect((await gate.check(OLLAMA, "second:30b")).outcome).toBe("admitted");
  });

  it("counts a model the CPU holds as loaded and evictable", async () => {
    // On unified memory a size_vram of 0 is still host memory, and still a
    // model against Ollama's limit.
    const fetchFn = jest.fn(async (url: string): Promise<Response> => {
      const json = (body: unknown) =>
        ({ ok: true, status: 200, json: async () => body }) as Response;
      if (url.endsWith("/api/ps")) {
        return json({
          models: [{ name: "embed:latest", size: 24 * GIB, size_vram: 0 }],
        });
      }
      if (url.endsWith("/api/tags")) {
        return json({ models: [{ name: MODEL, size: 24 * GIB }] });
      }
      return json({ reclaimableBytes: 10 * GIB });
    });
    const gate = createHostMemoryGate({
      probeUrl: PROBE,
      headroomBytes: 4 * GIB,
      fetchFn,
    });
    expect((await gate.check(OLLAMA, MODEL)).outcome).toBe("admitted");
  });

  it.each([
    ["mistral", "mistral:latest"],
    ["qwen3.5:9b", "qwen3.5:9b"],
    ["library/mistral", "mistral:latest"],
    ["hf.co/org/model:Q4_K_M", "hf.co/org/model:Q4_K_M"],
    ["registry.local:5000/x", "registry.local:5000/x:latest"],
  ])("names %s as Ollama lists it: %s", (given, listed) => {
    expect(canonicalModel(given)).toBe(listed);
  });

  it("matches an untagged model to the name Ollama lists", async () => {
    const gate = gateFor({
      resident: ["mistral:latest"],
      tags: ["mistral:latest"],
      reclaimable: 0,
    });
    expect((await gate.check(OLLAMA, "mistral")).outcome).toBe("admitted");
    const unloaded = gateFor({ tags: ["mistral:latest"], reclaimable: 0 });
    expect((await unloaded.check(OLLAMA, "mistral")).outcome).toBe("deferred");
  });

  it("leaves a model Ollama does not have to fail on its own", async () => {
    expect(await outcome({ tags: ["something:else"], reclaimable: 0 })).toBe(
      "admitted",
    );
  });

  it("fails closed when the probe is down or answers nonsense", async () => {
    expect(await outcome({ reclaimable: "down" })).toBe("probe_unreachable");
    expect(await outcome({ reclaimable: "garbage" })).toBe("probe_unreachable");
  });

  it("leaves an unreachable Ollama to fail on its own", async () => {
    expect(await outcome({ ollamaDown: true, reclaimable: 0 })).toBe(
      "admitted",
    );
  });

  it("says what it decided from", async () => {
    const onOutcome = jest.fn();
    const decision = await gateFor(
      { size: 24 * GIB, reclaimable: 20 * GIB },
      onOutcome,
    ).check(OLLAMA, MODEL);
    expect(decision).toEqual({
      outcome: "deferred",
      model: MODEL,
      neededBytes: 28 * GIB,
      reclaimableBytes: 20 * GIB,
    });
    expect(onOutcome).toHaveBeenCalledWith("deferred", {
      model: MODEL,
      neededBytes: 28 * GIB,
      reclaimableBytes: 20 * GIB,
    });
  });

  it("reads a model's size once", async () => {
    const fetchFn = fakeFetch({ reclaimable: 30 * GIB });
    const gate = createHostMemoryGate({
      probeUrl: PROBE,
      headroomBytes: 0,
      fetchFn,
    });
    await gate.check(OLLAMA, MODEL);
    await gate.check(OLLAMA, MODEL);
    const tags = fetchFn.mock.calls.filter((c) => c[0].endsWith("/api/tags"));
    expect(tags).toHaveLength(1);
  });

  it("takes the headroom from the environment, or 4 GB", () => {
    expect(headroomBytesFrom("2")).toBe(2 * GIB);
    expect(headroomBytesFrom("0")).toBe(0);
    expect(headroomBytesFrom(undefined)).toBe(4 * GIB);
    expect(headroomBytesFrom("lots")).toBe(4 * GIB);
    expect(headroomBytesFrom("-1")).toBe(4 * GIB);
  });

  describe("the shared gate", () => {
    const saved = process.env.LLM_HOST_MEMORY_URL;
    afterEach(() => {
      resetSharedHostMemoryGate();
      if (saved === undefined) delete process.env.LLM_HOST_MEMORY_URL;
      else process.env.LLM_HOST_MEMORY_URL = saved;
    });

    it("is off without a probe URL", () => {
      delete process.env.LLM_HOST_MEMORY_URL;
      expect(sharedHostMemoryGate()).toBeNull();
    });

    it("is one gate per process once configured", () => {
      process.env.LLM_HOST_MEMORY_URL = PROBE;
      const gate = sharedHostMemoryGate();
      expect(gate).not.toBeNull();
      expect(sharedHostMemoryGate()).toBe(gate);
    });

    it("counts every outcome, and warns once a minute per model", async () => {
      process.env.LLM_HOST_MEMORY_URL = PROBE;
      const realFetch = global.fetch;
      global.fetch = fakeFetch({ reclaimable: 1 * GIB }) as typeof fetch;
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      try {
        // A first caller with no observer, then one with: the counter
        // still reaches the observer bound later.
        const gate = sharedHostMemoryGate()!;
        const observer = { increment: jest.fn(), observe: jest.fn() };
        sharedHostMemoryGate(observer);
        await gate.check(OLLAMA, MODEL);
        await gate.check(OLLAMA, MODEL);
        expect(observer.increment).toHaveBeenCalledTimes(2);
        expect(observer.increment).toHaveBeenCalledWith(
          "llm_host_gate_total",
          1,
          { model: MODEL, outcome: "deferred" },
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/1\.0 GiB reclaimable/);
      } finally {
        global.fetch = realFetch;
      }
    });
  });
});
