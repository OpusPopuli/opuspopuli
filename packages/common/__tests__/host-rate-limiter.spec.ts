import {
  clampPolicy,
  hostOf,
  jittered,
  MemoryHostRateLimiter,
  resolveHostRatePolicies,
} from "../src/providers/rate-limiting/host-rate-limiter";

const FALLBACK = { requestsPerSecond: 2, burstSize: 5 };

describe("resolveHostRatePolicies (S1)", () => {
  it("gives every host a region names that region's rate limit", () => {
    // federal.json's FEC limit, which was declared and never applied.
    const policies = resolveHostRatePolicies(
      [
        {
          rateLimit: { requestsPerSecond: 0.25, burstSize: 1 },
          dataSources: [
            { url: "https://api.open.fec.gov/v1/schedules/" },
            { url: "https://www.fec.gov/files/bulk-downloads/" },
          ],
        },
      ],
      FALLBACK,
    );

    expect(policies.get("api.open.fec.gov")).toEqual({
      requestsPerSecond: 0.25,
      burstSize: 1,
    });
    expect(policies.get("www.fec.gov")).toEqual({
      requestsPerSecond: 0.25,
      burstSize: 1,
    });
  });

  it("lets a source override set the rate, keeping the region burst", () => {
    const policies = resolveHostRatePolicies(
      [
        {
          rateLimit: { requestsPerSecond: 1, burstSize: 3 },
          dataSources: [
            {
              url: "https://leginfo.legislature.ca.gov/faces/",
              rateLimitOverride: 0.5,
            },
          ],
        },
      ],
      FALLBACK,
    );

    expect(policies.get("leginfo.legislature.ca.gov")).toEqual({
      requestsPerSecond: 0.5,
      burstSize: 3,
    });
  });

  it("falls back to the default for a region that declares nothing", () => {
    const policies = resolveHostRatePolicies(
      [{ dataSources: [{ url: "https://oag.ca.gov/initiatives" }] }],
      FALLBACK,
    );

    expect(policies.get("oag.ca.gov")).toEqual(FALLBACK);
  });

  it("takes the strictest policy when two regions name one host", () => {
    // Rate from one, burst from the other: neither config may loosen it.
    const policies = resolveHostRatePolicies(
      [
        {
          rateLimit: { requestsPerSecond: 1, burstSize: 3 },
          dataSources: [{ url: "https://www.sos.ca.gov/a" }],
        },
        {
          rateLimit: { requestsPerSecond: 4, burstSize: 1 },
          dataSources: [{ url: "https://WWW.SOS.CA.GOV/b" }],
        },
      ],
      FALLBACK,
    );

    expect(policies.get("www.sos.ca.gov")).toEqual({
      requestsPerSecond: 1,
      burstSize: 1,
    });
  });

  it("skips a source whose URL does not parse", () => {
    const policies = resolveHostRatePolicies(
      [{ dataSources: [{ url: "not a url" }] }],
      FALLBACK,
    );

    expect(policies.size).toBe(0);
  });
});

describe("resolveHostRatePolicies — bad values (S1 review)", () => {
  const one = (
    rateLimit: { requestsPerSecond: number; burstSize: number } | undefined,
    rateLimitOverride?: number,
  ) => {
    const rejected: unknown[] = [];
    const policies = resolveHostRatePolicies(
      [
        {
          rateLimit,
          dataSources: [{ url: "https://oag.ca.gov/x", rateLimitOverride }],
        },
      ],
      FALLBACK,
      (r) => rejected.push(r),
    );
    return { policy: policies.get("oag.ca.gov"), rejected };
  };

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "ignores a region rate of %p and reports it",
    (rate) => {
      // Rate 0 made the bucket compute an infinite wait, and acquire spun
      // against Redis every millisecond forever.
      const { policy, rejected } = one({
        requestsPerSecond: rate,
        burstSize: 3,
      });
      expect(policy).toEqual(FALLBACK);
      expect(rejected).toHaveLength(1);
    },
  );

  it("treats an override of 0 as no override, as the old throttle did", () => {
    const { policy, rejected } = one({ requestsPerSecond: 1, burstSize: 3 }, 0);
    expect(policy).toEqual({ requestsPerSecond: 1, burstSize: 3 });
    expect(rejected).toHaveLength(0);
  });

  it("ignores and reports a negative override", () => {
    const { policy, rejected } = one(
      { requestsPerSecond: 1, burstSize: 3 },
      -2,
    );
    expect(policy).toEqual({ requestsPerSecond: 1, burstSize: 3 });
    expect(rejected).toEqual([
      { host: "oag.ca.gov", field: "rateLimitOverride", value: -2 },
    ]);
  });

  it("caps a huge rate, so no config can flood a government site", () => {
    expect(one({ requestsPerSecond: 1e6, burstSize: 1e6 }).policy).toEqual({
      requestsPerSecond: 10,
      burstSize: 20,
    });
  });

  it("floors a tiny rate and a fractional burst", () => {
    expect(clampPolicy({ requestsPerSecond: 1e-9, burstSize: 0.4 })).toEqual({
      requestsPerSecond: 0.01,
      burstSize: 1,
    });
    expect(clampPolicy({ requestsPerSecond: 1, burstSize: 2.7 })).toEqual({
      requestsPerSecond: 1,
      burstSize: 2,
    });
  });
});

describe("jittered", () => {
  it("bounds a non-finite or overflowing wait instead of spinning", () => {
    // Node turns a setTimeout over 2^31ms into 1ms — a spin.
    expect(jittered(Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(66_000);
    expect(jittered(1e12)).toBeLessThanOrEqual(66_000);
    expect(jittered(-5)).toBeGreaterThanOrEqual(1);
  });

  it("adds at most 10%", () => {
    for (let i = 0; i < 50; i++) {
      const ms = jittered(1000);
      expect(ms).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThanOrEqual(1100);
    }
  });
});

describe("hostOf", () => {
  it("lower-cases, and is undefined for a URL that does not parse", () => {
    expect(hostOf("https://WWW.Senate.CA.gov/x")).toBe("www.senate.ca.gov");
    // One site, one bucket: a trailing dot would double its rate.
    expect(hostOf("https://www.fec.gov./files")).toBe("www.fec.gov");
    expect(hostOf("https://www.fec.gov../files")).toBe("www.fec.gov");
    expect(hostOf("nope")).toBeUndefined();
  });
});

describe("MemoryHostRateLimiter (S1)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MemoryHostRateLimiter.resetPolicies();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Whether `acquire` resolves without any time passing. */
  const resolvesNow = async (p: Promise<void>): Promise<boolean> => {
    let done = false;
    void p.then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    return done;
  };

  it("gives each host its own bucket", async () => {
    // The S1 problem: one shared bucket made every host wait on the others.
    const limiter = new MemoryHostRateLimiter({
      requestsPerSecond: 1,
      burstSize: 1,
    });

    await limiter.acquire("https://www.assembly.ca.gov/a");

    expect(
      await resolvesNow(limiter.acquire("https://www.senate.ca.gov/a")),
    ).toBe(true);
    expect(
      await resolvesNow(limiter.acquire("https://www.assembly.ca.gov/b")),
    ).toBe(false);
  });

  it("keeps each instance's buckets apart", async () => {
    // A throttled acquire in one instance must not consume another's
    // budget — the isolation the per-instance limiter it replaced had.
    const policy = { requestsPerSecond: 1, burstSize: 1 };
    const a = new MemoryHostRateLimiter(policy);
    const b = new MemoryHostRateLimiter(policy);

    await a.acquire("https://leginfo.legislature.ca.gov/x");

    expect(
      await resolvesNow(b.acquire("https://leginfo.legislature.ca.gov/y")),
    ).toBe(true);
  });

  it("applies a policy set through any instance", async () => {
    const a = new MemoryHostRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
    const b = new MemoryHostRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
    await a.setPolicies(
      new Map([["oag.ca.gov", { requestsPerSecond: 1, burstSize: 3 }]]),
    );

    for (let i = 0; i < 3; i++) {
      expect(await resolvesNow(b.acquire("https://oag.ca.gov/p"))).toBe(true);
    }
    expect(await resolvesNow(b.acquire("https://oag.ca.gov/p"))).toBe(false);
  });

  it("spaces concurrent acquires instead of releasing them together", async () => {
    // Carried over from HostThrottle's race test: N concurrent callers on
    // one host must complete at +0, +gap, +2gap — not all at +gap.
    jest.useRealTimers();
    const limiter = new MemoryHostRateLimiter({
      requestsPerSecond: 20,
      burstSize: 1,
    });
    const start = Date.now();
    const done: number[] = [];

    await Promise.all(
      [0, 1, 2].map(async () => {
        await limiter.acquire("https://racy.example/p");
        done.push(Date.now() - start);
      }),
    );

    done.sort((a, b) => a - b);
    // 20 rps → 50ms per token after the first.
    expect(done[2] - done[0]).toBeGreaterThanOrEqual(90);
  });

  it("does not throttle a URL that does not parse", async () => {
    const limiter = new MemoryHostRateLimiter(FALLBACK);

    await expect(limiter.acquire("not a url")).resolves.toBeUndefined();
  });
});
