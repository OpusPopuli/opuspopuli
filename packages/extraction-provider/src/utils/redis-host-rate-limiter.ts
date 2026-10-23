/**
 * Redis Host Rate Limiter — one token bucket per target host, with the
 * host's policy stored beside it (S1, `docs/plans/S1-per-host-rate-limiter.md`).
 *
 * Replaces the single `extraction:ratelimit` bucket, which put every host
 * behind every other, and region's in-process `HostThrottle`, which gave each
 * process its own budget for the same government site.
 *
 * **Why the policy is in Redis too.** The limiter is built in more than one
 * DI scope — `ExtractionProvider` inside the scraping pipeline's, the bills
 * sync's outside it — and a policy held in one instance would leave the other
 * enforcing the default: the FEC host back at 2 rps against a 0.25 rps quota.
 * Read from Redis on every acquire, the policy is the same for every instance
 * in every process.
 */

import { Logger, type OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";
import {
  clampPolicy,
  HOST_RATE_BOUNDS,
  hostOf,
  jittered,
  MemoryHostRateLimiter,
  type HostRatePolicy,
  type IHostRateLimiter,
} from "@opuspopuli/common";
import { createRedisClient } from "./redis-utils";

interface RedisWithHostBucket extends Redis {
  hostTokenBucket(
    bucketKey: string,
    policyKey: string,
    defaultRate: number,
    defaultBurst: number,
    maxRate: number,
    maxBurst: number,
  ): Promise<[number, number]>;
}

export interface RedisHostRateLimiterOptions {
  url?: string;
  host?: string;
  port?: number;
  lazyConnect?: boolean;
  /** Key prefix; buckets are `<prefix><host>`, policies `<prefix>policy:<host>`. */
  keyPrefix?: string;
  /** Policy for a host that has none stored. */
  fallback: HostRatePolicy;
}

/**
 * The key every host limiter in the system uses, as `CacheFactoryConfig.
 * rateLimiterKey`. Exported so a limiter built outside `ExtractionProvider`
 * (the bills sync's) cannot drift to a different key — two keys would be two
 * budgets for the same government site.
 */
export const HOST_RATE_LIMITER_KEY = "extraction:ratelimit";

/** How long a dropped connection waits before this limiter reconnects. */
const RECONNECT_BACKOFF_MS = 5_000;

/**
 * Atomic per-host token bucket. KEYS[1] is the host's bucket, KEYS[2] its
 * policy hash; a valid stored policy overrides the defaults in ARGV. Returns
 * [tokens_remaining, wait_ms].
 *
 * The clock is Redis's own (`TIME`), not the caller's: every process shares
 * one bucket, and a client clock that stepped backwards would have drained it
 * below zero. Rates and bursts are guarded here as well as at publication —
 * a rate of 0 made the old script compute an infinite wait, and the caller
 * spun against Redis every millisecond forever.
 */
const HOST_TOKEN_BUCKET_SCRIPT = `
local bucket = KEYS[1]
local policy = KEYS[2]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])

local p = redis.call('HMGET', policy, 'rate', 'burst')
local prate = tonumber(p[1])
local pburst = tonumber(p[2])
if prate and prate > 0 then rate = prate end
if pburst and pburst >= 1 then burst = pburst end
if not rate or rate <= 0 then rate = 1 end
if not burst or burst < 1 then burst = 1 end
-- The same ceiling publication clamps to (HOST_RATE_BOUNDS), enforced here
-- too: a policy hash written any other way must not lift it.
rate = math.min(rate, tonumber(ARGV[3]))
burst = math.min(burst, tonumber(ARGV[4]))

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local data = redis.call('HMGET', bucket, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or burst
local last_refill = tonumber(data[2]) or now
local elapsed = math.max(0, now - last_refill)
tokens = math.min(burst, tokens + elapsed * rate / 1000)

if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HSET', bucket, 'tokens', tokens, 'last_refill', now)
  -- Long enough to outlive a refill at this policy, so an idle bucket is
  -- never reset to full before it would have refilled anyway.
  redis.call('PEXPIRE', bucket, math.max(60000, math.ceil(burst * 1000 / rate) * 2))
  return {tokens, 0}
end
return {tokens, math.ceil((1 - tokens) * 1000 / rate)}
`;

export class RedisHostRateLimiter implements IHostRateLimiter, OnModuleDestroy {
  private readonly logger = new Logger(RedisHostRateLimiter.name);
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly fallback: HostRatePolicy;
  /**
   * What requests use while Redis is unreachable: this process's mirror of
   * the published policies. Per process, so it is looser across a fleet than
   * the shared bucket — but bounded, which failing fully open was not. The
   * per-process throttle this replaced at least did that much.
   */
  private readonly degraded: MemoryHostRateLimiter;
  private isConnected = false;
  /** Set by destroy(): no reconnect after it, and waits go to `degraded`. */
  private destroyed = false;
  /** Set while degraded, so the warning is logged once per outage. */
  private failing = false;
  private lastReconnectAt = 0;

  constructor(options: RedisHostRateLimiterOptions) {
    this.prefix = options.keyPrefix ?? `${HOST_RATE_LIMITER_KEY}:`;
    this.fallback = clampPolicy(options.fallback);
    this.degraded = new MemoryHostRateLimiter(this.fallback);
    this.redis = createRedisClient(
      {
        url: options.url,
        host: options.host,
        port: options.port,
        lazyConnect: options.lazyConnect,
      },
      (connected) => {
        this.isConnected = connected;
      },
    );
    this.redis.defineCommand("hostTokenBucket", {
      numberOfKeys: 2,
      lua: HOST_TOKEN_BUCKET_SCRIPT,
    });
  }

  /**
   * Wait for this URL's host. On a Redis error the request waits on the
   * degraded in-process limiter instead — said once, at warn, and lifted
   * when Redis answers again.
   */
  async acquire(url: string): Promise<void> {
    const host = hostOf(url);
    if (!host) return;
    for (;;) {
      if (this.destroyed) return this.degraded.acquire(url);
      const waitMs = await this.tryTake(host);
      if (waitMs === undefined) return this.degraded.acquire(url);
      if (!(waitMs > 0)) return;
      await sleep(jittered(waitMs));
    }
  }

  /**
   * Publish policies — ADDITIVELY: every host in the map is written; nothing
   * is ever deleted.
   *
   * Replacing the whole set was tried and reviewed out. Three processes
   * publish (region, region-worker, structural-analysis-worker), each hourly,
   * and any of them can briefly hold a partial view — a local plugin that
   * failed to load, the window inside a reload, a stale set after an admin
   * toggle elsewhere. A replace from that view deleted the other hosts'
   * policies, and they ran at the default until the next publish. A host
   * left behind by additive publication keeps a clamped, at-worst-stricter
   * policy: the recoverable error.
   *
   * No TTL. Publication happens at plugin load, and a node can run for weeks
   * between loads; a policy that expired would put the FEC host back on the
   * default with nothing logged. Persistence is the noeviction, append-only
   * instance's job, and the region service also republishes on an interval.
   *
   * Also mirrored into this process's degraded limiter, whatever happens to
   * the Redis write.
   */
  async setPolicies(
    policies: ReadonlyMap<string, HostRatePolicy>,
  ): Promise<void> {
    const clamped = new Map(
      [...policies].map(([host, p]) => [host, clampPolicy(p)]),
    );
    await this.degraded.setPolicies(clamped);
    if (clamped.size === 0) return;
    try {
      await this.ensureConnected();
      const tx = this.redis.multi();
      for (const [host, policy] of clamped) {
        tx.hset(this.policyKey(host), {
          rate: policy.requestsPerSecond,
          burst: policy.burstSize,
        });
        // HSET keeps a key's existing TTL. Without this, a policy written by
        // a build that set one would still expire — found on UAT, where every
        // host kept the 7-day TTL the first S1 build gave it.
        tx.persist(this.policyKey(host));
      }
      const results = (await tx.exec()) ?? [];
      // `exec` reports a failed command in its tuple instead of throwing.
      const failed = results.find(([error]) => error);
      if (failed) throw failed[0];
    } catch (error) {
      // Not fatal: the next republish retries, and this process is covered
      // by the mirror. But hosts in OTHER processes run at the default until
      // then, which for the FEC API is above its quota — so it is loud.
      this.logger.error(
        `Could not store ${clamped.size} host rate policies in Redis; other ` +
          `processes run those hosts at the default until the next ` +
          `republish: ${(error as Error).message}`,
      );
    }
  }

  async destroy(): Promise<void> {
    // First, so a waiter that wakes after shutdown — a sync sleeping on a 4s
    // FEC token — cannot reconnect the client this is closing.
    this.destroyed = true;
    // `quit` on a client that never connected (or has ended) waits on a
    // connection that will not come, holding the process open; drop it.
    if (this.redis.status !== "ready") {
      // A client mid-reconnect has a retry timer pending; wait (briefly) for
      // it to actually end, so shutdown does not race it.
      const ended = new Promise<void>((resolve) => {
        if (this.redis.status === "end") return resolve();
        this.redis.once("end", () => resolve());
        setTimeout(resolve, 500).unref();
      });
      this.redis.disconnect();
      await ended;
      return;
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }

  /**
   * Milliseconds to wait (0 = a token was taken), or undefined when Redis
   * could not answer and the caller should use the degraded limiter.
   */
  private async tryTake(host: string): Promise<number | undefined> {
    try {
      await this.ensureConnected();
      const [, waitMs] = await (
        this.redis as RedisWithHostBucket
      ).hostTokenBucket(
        this.prefix + host,
        this.policyKey(host),
        this.fallback.requestsPerSecond,
        this.fallback.burstSize,
        HOST_RATE_BOUNDS.maxRequestsPerSecond,
        HOST_RATE_BOUNDS.maxBurst,
      );
      if (this.failing) {
        this.failing = false;
        this.logger.log("Host rate limiter reconnected to Redis");
      }
      return waitMs;
    } catch (error) {
      if (!this.failing) {
        this.failing = true;
        this.logger.warn(
          `Host rate limiter cannot reach Redis; throttling per process from ` +
            `the last published policies until it recovers: ` +
            `${(error as Error).message}`,
        );
      }
      return undefined;
    }
  }

  private policyKey(host: string): string {
    return `${this.prefix}policy:${host}`;
  }

  /**
   * Connect lazily, and again after ioredis gives up. Its retry strategy
   * stops after a few attempts and leaves the client `end`ed for good; the
   * limiter this replaced never reconnected from there, so one blip made it
   * fail open until the process restarted. Rate-limited to one attempt per
   * {@link RECONNECT_BACKOFF_MS}.
   */
  private async ensureConnected(): Promise<void> {
    if (this.isConnected) return;
    if (this.destroyed) throw new Error("host rate limiter destroyed");
    const status = this.redis.status;
    if (status === "wait") {
      await this.redis.connect();
      return;
    }
    if (
      status === "end" &&
      Date.now() - this.lastReconnectAt > RECONNECT_BACKOFF_MS
    ) {
      this.lastReconnectAt = Date.now();
      await this.redis.connect();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
