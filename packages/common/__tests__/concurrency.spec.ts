import { mapWithConcurrency } from "../src/utils/concurrency";

describe("mapWithConcurrency", () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("never runs more than `limit` at once, and returns results in item order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency(
      [30, 5, 20, 1, 10],
      2,
      async (ms, i) => {
        active++;
        peak = Math.max(peak, active);
        await tick(ms);
        active--;
        return i;
      },
    );

    expect(peak).toBe(2);
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it("does nothing for no items, and rejects a non-positive limit", async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(
      /positive integer/,
    );
  });

  it("rejects when a call rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("starts nothing more after a rejection — an abort stops the work", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        await new Promise((r) => setTimeout(r, 5));
        if (n === 1) throw new Error("abort");
        return n;
      }),
    ).rejects.toThrow("abort");
    await new Promise((r) => setTimeout(r, 50));
    // 0 and 1 ran together; 1 failed, so 2.. never started (0's lane may
    // have taken one more before seeing the failure).
    expect(started.length).toBeLessThanOrEqual(3);
  });

  it("rejects only after the calls already running have finished", async () => {
    let slowDone = false;
    await expect(
      mapWithConcurrency([0, 1], 2, async (n) => {
        if (n === 0) {
          await new Promise((r) => setTimeout(r, 30));
          slowDone = true;
          return n;
        }
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    // The caller's cleanup runs with nothing still in flight.
    expect(slowDone).toBe(true);
  });
});
