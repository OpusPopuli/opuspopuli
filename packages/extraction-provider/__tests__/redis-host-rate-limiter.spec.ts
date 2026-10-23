/**
 * RedisHostRateLimiter with a mocked ioredis (S1).
 *
 * The integration spec proves the Lua script against a real Redis; this one
 * covers the client-side behaviour around it — replace-not-upsert
 * publication, degraded mode, reconnecting after ioredis gives up — which a
 * real Redis cannot easily be made to exercise.
 */
import { Logger } from "@nestjs/common";
import { MemoryHostRateLimiter } from "@opuspopuli/common";
import { RedisHostRateLimiter } from "../src/utils/redis-host-rate-limiter";

const tx = {
  del: jest.fn(),
  hset: jest.fn(),
  persist: jest.fn(),
  sadd: jest.fn(),
  exec: jest.fn(),
};
const mockRedis = {
  on: jest.fn(),
  once: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
  defineCommand: jest.fn(),
  hostTokenBucket: jest.fn(),
  smembers: jest.fn(),
  multi: jest.fn(() => tx),
  status: "wait" as string,
};

jest.mock("ioredis", () => jest.fn().mockImplementation(() => mockRedis));

const FALLBACK = { requestsPerSecond: 2, burstSize: 5 };

describe("RedisHostRateLimiter (Unit)", () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    MemoryHostRateLimiter.resetPolicies();
    mockRedis.status = "wait";
    mockRedis.hostTokenBucket.mockResolvedValue([4, 0]);
    mockRedis.smembers.mockResolvedValue([]);
    tx.exec.mockResolvedValue([]);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  const make = () =>
    new RedisHostRateLimiter({
      url: "redis://localhost:6379",
      keyPrefix: "t:",
      fallback: FALLBACK,
    });

  it("keys the bucket and policy by host, not by URL", async () => {
    await make().acquire("https://api.open.fec.gov/v1/x?api_key=SECRET");

    expect(mockRedis.hostTokenBucket).toHaveBeenCalledWith(
      "t:api.open.fec.gov",
      "t:policy:api.open.fec.gov",
      2,
      5,
      // The ceiling, passed so the script enforces it too.
      10,
      20,
    );
  });

  it("publishes additively: it never deletes a host another process published", async () => {
    // Replace-the-set was reviewed out: three processes publish hourly, and
    // one holding a partial view (a failed plugin, mid-reload) deleted the
    // others' hosts, which then ran at the default.
    await make().setPolicies(
      new Map([["oag.ca.gov", { requestsPerSecond: 1, burstSize: 3 }]]),
    );

    expect(tx.del).not.toHaveBeenCalled();
    expect(mockRedis.smembers).not.toHaveBeenCalled();
    expect(tx.hset).toHaveBeenCalledWith("t:policy:oag.ca.gov", {
      rate: 1,
      burst: 3,
    });
    expect(tx.persist).toHaveBeenCalledWith("t:policy:oag.ca.gov");
  });

  it("clamps what it publishes", async () => {
    await make().setPolicies(
      new Map([["x.gov", { requestsPerSecond: 1e6, burstSize: 0 }]]),
    );

    expect(tx.hset).toHaveBeenCalledWith("t:policy:x.gov", {
      rate: 10,
      burst: 1,
    });
  });

  it("writes nothing for an empty set", async () => {
    await make().setPolicies(new Map());

    expect(mockRedis.multi).not.toHaveBeenCalled();
  });

  it("logs, and does not throw, when a command inside the transaction fails", async () => {
    // `exec` reports failures in its tuples instead of throwing.
    tx.exec.mockResolvedValue([[new Error("WRONGTYPE"), null]]);

    await expect(
      make().setPolicies(
        new Map([["x.gov", { requestsPerSecond: 1, burstSize: 1 }]]),
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("degrades to the in-process limiter when Redis fails, warning once", async () => {
    // Fully open was a regression: the per-process throttle this replaced
    // kept throttling during a Redis outage.
    mockRedis.hostTokenBucket.mockRejectedValue(
      new Error("Connection is closed"),
    );
    const degraded = jest.spyOn(MemoryHostRateLimiter.prototype, "acquire");
    const limiter = make();

    await limiter.acquire("https://www.sos.ca.gov/a");
    await limiter.acquire("https://www.sos.ca.gov/b");

    expect(degraded).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("applies the published policy while degraded", async () => {
    mockRedis.hostTokenBucket.mockRejectedValue(new Error("down"));
    tx.exec.mockRejectedValue(new Error("down"));
    const limiter = make();
    await limiter.setPolicies(
      new Map([["www.fec.gov", { requestsPerSecond: 1, burstSize: 1 }]]),
    );
    jest.useFakeTimers();
    try {
      await limiter.acquire("https://www.fec.gov/a");
      let second = false;
      void limiter.acquire("https://www.fec.gov/b").then(() => {
        second = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      // Burst 1 from the mirrored policy, not the fallback's 5.
      expect(second).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reconnects after ioredis has given up, rather than staying degraded", async () => {
    // ioredis ends the client after its retries; the limiter this replaced
    // never reconnected from there.
    mockRedis.status = "end";

    await make().acquire("https://www.sos.ca.gov/a");

    expect(mockRedis.connect).toHaveBeenCalledTimes(1);
  });

  it("treats a non-positive wait as proceed, never as a spin", async () => {
    mockRedis.hostTokenBucket.mockResolvedValue([0, -1000]);

    await expect(
      make().acquire("https://www.sos.ca.gov/a"),
    ).resolves.toBeUndefined();
    expect(mockRedis.hostTokenBucket).toHaveBeenCalledTimes(1);
  });

  it("never reconnects after destroy, so a late waiter cannot hold shutdown", async () => {
    // A sync sleeping on a 4s FEC token wakes after shutdown; it must not
    // reopen the client destroy() just closed.
    const degraded = jest.spyOn(MemoryHostRateLimiter.prototype, "acquire");
    const limiter = make();
    await limiter.destroy();
    mockRedis.status = "end";

    await limiter.acquire("https://www.sos.ca.gov/a");

    expect(mockRedis.connect).not.toHaveBeenCalled();
    expect(mockRedis.hostTokenBucket).not.toHaveBeenCalled();
    expect(degraded).toHaveBeenCalledTimes(1);
  });

  it("quits a connected client on module destroy", async () => {
    mockRedis.status = "ready";

    await make().onModuleDestroy();

    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
  });

  it("drops a client that never connected instead of waiting on quit", async () => {
    // quit() on an unconnected client waits for a connection that will not
    // come, holding the process open.
    mockRedis.status = "end";

    await make().onModuleDestroy();

    expect(mockRedis.disconnect).toHaveBeenCalledTimes(1);
    expect(mockRedis.quit).not.toHaveBeenCalled();
  });
});
