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
});
