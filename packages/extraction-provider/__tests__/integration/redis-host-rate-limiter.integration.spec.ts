/**
 * RedisHostRateLimiter against a real Redis (S1).
 *
 * The properties that matter are cross-instance — two limiters built in
 * different DI scopes (or processes) enforcing ONE budget per host, under ONE
 * policy — and a mocked ioredis cannot show either: the Lua script is what
 * enforces them. Each test uses its own key prefix and deletes it after.
 */
import Redis from "ioredis";
import { RedisHostRateLimiter } from "../../src/utils/redis-host-rate-limiter";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const FALLBACK = { requestsPerSecond: 2, burstSize: 5 };

describe("RedisHostRateLimiter (Integration)", () => {
  let prefix: string;
  let limiters: RedisHostRateLimiter[];
  let admin: Redis;

  const make = (fallback = FALLBACK) => {
    const limiter = new RedisHostRateLimiter({
      url: REDIS_URL,
      keyPrefix: prefix,
      fallback,
    });
    limiters.push(limiter);
    return limiter;
  };

  /** Time `n` acquires against one URL, in ms. */
  const timeAcquires = async (
    limiter: RedisHostRateLimiter,
    url: string,
    n: number,
  ): Promise<number> => {
    const start = Date.now();
    for (let i = 0; i < n; i++) await limiter.acquire(url);
    return Date.now() - start;
  };

  beforeAll(() => {
    admin = new Redis(REDIS_URL);
  });

  beforeEach(() => {
    prefix = `test:hostratelimit:${Date.now()}:${Math.random()}:`;
    limiters = [];
  });

  afterEach(async () => {
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length > 0) await admin.del(...keys);
    await Promise.all(limiters.map((l) => l.destroy()));
  });

  afterAll(async () => {
    await admin.quit();
  });

  it("gives each host its own bucket", async () => {
    // The S1 problem: one bucket for every host.
    const limiter = make({ requestsPerSecond: 2, burstSize: 1 });
    await limiter.acquire("https://www.assembly.ca.gov/a");

    // Another host is not held up by the first one's empty bucket.
    expect(
      await timeAcquires(limiter, "https://www.senate.ca.gov/a", 1),
    ).toBeLessThan(100);
    // The first host is: one token per 500ms.
    expect(
      await timeAcquires(limiter, "https://www.assembly.ca.gov/b", 1),
    ).toBeGreaterThanOrEqual(400);
  });

  it("enforces one budget per host across two instances", async () => {
    // H2: each process used to get its own budget for the same site.
    const a = make({ requestsPerSecond: 2, burstSize: 1 });
    const b = make({ requestsPerSecond: 2, burstSize: 1 });

    await a.acquire("https://leginfo.legislature.ca.gov/x");

    expect(
      await timeAcquires(b, "https://leginfo.legislature.ca.gov/y", 1),
    ).toBeGreaterThanOrEqual(400);
  });

  it("applies a policy stored by one instance to another", async () => {
    // The FEC case: the policy is written by the region plugin service and
    // must govern the limiter inside the scraping pipeline's DI scope.
    const writer = make();
    const reader = make(); // fallback 2 rps, burst 5 — far looser
    await writer.setPolicies(
      new Map([["api.open.fec.gov", { requestsPerSecond: 4, burstSize: 1 }]]),
    );

    // Burst 1 at 4 rps: the second request waits ~250ms. Under the reader's
    // own fallback (burst 5) it would not wait at all.
    await reader.acquire("https://api.open.fec.gov/v1/a");
    expect(
      await timeAcquires(reader, "https://api.open.fec.gov/v1/b", 1),
    ).toBeGreaterThanOrEqual(200);
  });

  it("stores policies with no TTL, and publishes additively", async () => {
    // A 7-day TTL with nothing refreshing it put the FEC host back on the
    // default after a week of uptime, silently. And a republish from a
    // process with a partial view must not delete another's hosts.
    const limiter = make();
    await limiter.setPolicies(
      new Map([
        ["oag.ca.gov", { requestsPerSecond: 1, burstSize: 3 }],
        ["other.example.gov", { requestsPerSecond: 1, burstSize: 1 }],
      ]),
    );
    expect(await admin.pttl(`${prefix}policy:oag.ca.gov`)).toBe(-1);
    expect(await admin.hgetall(`${prefix}policy:oag.ca.gov`)).toEqual({
      rate: "1",
      burst: "3",
    });

    await limiter.setPolicies(
      new Map([["oag.ca.gov", { requestsPerSecond: 1, burstSize: 3 }]]),
    );

    expect(await admin.exists(`${prefix}policy:other.example.gov`)).toBe(1);
  });

  it("enforces the ceiling on a policy written behind its back", async () => {
    // 1000 rps stored directly: the script caps it at 10, so the second
    // request waits ~100ms rather than ~1ms.
    await admin.hset(`${prefix}policy:fast.example.gov`, {
      rate: "1000",
      burst: "1",
    });
    const limiter = make();

    const elapsed = await timeAcquires(
      limiter,
      "https://fast.example.gov/a",
      2,
    );

    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("clears a TTL an older build left on a policy it rewrites", async () => {
    // HSET keeps a key's TTL, so "replace" alone left every surviving host's
    // 7-day expiry in place — caught on UAT after the first fix.
    await admin.hset(`${prefix}policy:oag.ca.gov`, { rate: "2", burst: "5" });
    await admin.pexpire(`${prefix}policy:oag.ca.gov`, 604_800_000);

    await make().setPolicies(
      new Map([["oag.ca.gov", { requestsPerSecond: 1, burstSize: 3 }]]),
    );

    expect(await admin.pttl(`${prefix}policy:oag.ca.gov`)).toBe(-1);
  });

  it("does not spin on a bad policy written behind its back", async () => {
    // Rate 0 used to give an infinite wait and a 1ms EVAL loop forever; the
    // script now treats an invalid stored policy as absent.
    await admin.hset(`${prefix}policy:bad.example.gov`, {
      rate: "0",
      burst: "0",
    });
    const limiter = make({ requestsPerSecond: 2, burstSize: 1 });

    const elapsed = await timeAcquires(limiter, "https://bad.example.gov/a", 2);

    // The caller's fallback (2 rps, burst 1): the second waits ~500ms. The
    // script's last-resort floor (1 rps, ~1000ms) must NOT be what applies —
    // an invalid stored policy means "no policy", not "slowest policy".
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(900);
  });

  it("degrades, without throwing, when Redis is unreachable", async () => {
    const limiter = new RedisHostRateLimiter({
      url: "redis://127.0.0.1:1",
      keyPrefix: prefix,
      fallback: FALLBACK,
    });
    limiters.push(limiter);

    await expect(
      limiter.acquire("https://www.sos.ca.gov/a"),
    ).resolves.toBeUndefined();
  });
});
