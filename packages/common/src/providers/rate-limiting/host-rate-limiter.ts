/**
 * One rate limit per target host, shared by every caller (S1,
 * `docs/plans/S1-per-host-rate-limiter.md`).
 *
 * Before this, the scraping pipeline put every host in ONE bucket — so fetch
 * concurrency could not help, each host serialising behind the others — and
 * the bills sync ran its own per-process throttle, so N processes meant N×
 * the rate a government site saw (§7 H2 of the ingestion-lanes plan).
 */

import { RateLimiter } from "./rate-limiter.js";

/** A host's token bucket: steady rate and burst. */
export interface HostRatePolicy {
  requestsPerSecond: number;
  burstSize: number;
}

/**
 * A rate limiter keyed by the host of the URL being fetched.
 *
 * `acquire` takes the URL, not the host, so no caller can key it differently
 * from another — two spellings of one host would be two buckets.
 */
export interface IHostRateLimiter {
  /** Wait until a request to this URL's host is allowed. Never throws. */
  acquire(url: string): Promise<void>;
  /**
   * Replace the per-host policies: hosts in the map get theirs, every other
   * host the limiter's default. Implementations shared across processes must
   * make the policy visible to every process, not only this one.
   */
  setPolicies(policies: ReadonlyMap<string, HostRatePolicy>): Promise<void>;
  /** Release connections. Optional: the in-process limiter holds none. */
  destroy?(): Promise<void>;
}

/**
 * The bounds every policy is clamped to, whatever a config says.
 *
 * The floor keeps a bucket refilling within a reasonable time — a rate of 0
 * or below made the token bucket compute an infinite (or negative) wait, and
 * `acquire` then spun against Redis every millisecond forever. The ceiling is
 * a promise about our own behaviour: no config typo or bad publish can turn
 * this platform into a flood against a government site.
 */
export const HOST_RATE_BOUNDS = {
  minRequestsPerSecond: 0.01,
  maxRequestsPerSecond: 10,
  minBurst: 1,
  maxBurst: 20,
} as const;

/** The parts of a region config that set fetch rates. */
export interface RegionRateConfig {
  /** The region's own `rateLimit`, for every host its sources name. */
  rateLimit?: { requestsPerSecond: number; burstSize: number };
  dataSources: ReadonlyArray<{ url: string; rateLimitOverride?: number }>;
}

/** A config value the resolver refused — for the caller to log. */
export interface RejectedRateValue {
  host: string;
  field: "rateLimit" | "rateLimitOverride";
  value: unknown;
}

/**
 * The policy for every host the given regions name.
 *
 * Precedence, per host: a data source's `rateLimitOverride` (requests per
 * second) > the region's `rateLimit` > `fallback`. A host named by more than
 * one region — a county config pointing at a state site — takes the
 * STRICTEST: the lower rate and the lower burst. Politeness to a government
 * site is not something two configs should be able to add up.
 *
 * An override sets only the rate; its burst comes from the region, or the
 * fallback. An override of 0 means "no override", as it did for the throttle
 * this replaced. Any other value that is not a finite positive number is
 * ignored and reported through `onReject`; everything is clamped to
 * {@link HOST_RATE_BOUNDS}. Hosts that no config names are absent, and get
 * the fallback.
 */
export function resolveHostRatePolicies(
  regions: ReadonlyArray<RegionRateConfig>,
  fallback: HostRatePolicy,
  onReject?: (rejected: RejectedRateValue) => void,
): Map<string, HostRatePolicy> {
  const policies = new Map<string, HostRatePolicy>();
  for (const region of regions) {
    for (const source of region.dataSources) {
      const host = hostOf(source.url);
      if (!host) continue;
      const policy = policyFor(host, region, source, fallback, onReject);
      policies.set(host, strictest(policies.get(host), policy));
    }
  }
  return policies;
}

function policyFor(
  host: string,
  region: RegionRateConfig,
  source: { rateLimitOverride?: number },
  fallback: HostRatePolicy,
  onReject?: (rejected: RejectedRateValue) => void,
): HostRatePolicy {
  const base = regionBase(host, region, fallback, onReject);
  const override = source.rateLimitOverride;
  if (override !== undefined && override !== 0 && !isPositive(override)) {
    onReject?.({ host, field: "rateLimitOverride", value: override });
  }
  return clampPolicy({
    requestsPerSecond: isPositive(override) ? override : base.requestsPerSecond,
    burstSize: base.burstSize,
  });
}

function regionBase(
  host: string,
  region: RegionRateConfig,
  fallback: HostRatePolicy,
  onReject?: (rejected: RejectedRateValue) => void,
): HostRatePolicy {
  const declared = region.rateLimit;
  if (!declared) return fallback;
  if (!isPositive(declared.requestsPerSecond)) {
    onReject?.({ host, field: "rateLimit", value: declared });
    return fallback;
  }
  return {
    requestsPerSecond: declared.requestsPerSecond,
    burstSize: isPositive(declared.burstSize)
      ? declared.burstSize
      : fallback.burstSize,
  };
}

/** A policy forced inside {@link HOST_RATE_BOUNDS}, burst a whole number. */
export function clampPolicy(policy: HostRatePolicy): HostRatePolicy {
  const b = HOST_RATE_BOUNDS;
  return {
    requestsPerSecond: Math.min(
      b.maxRequestsPerSecond,
      Math.max(b.minRequestsPerSecond, policy.requestsPerSecond),
    ),
    burstSize: Math.min(
      b.maxBurst,
      Math.max(b.minBurst, Math.floor(policy.burstSize)),
    ),
  };
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function strictest(
  a: HostRatePolicy | undefined,
  b: HostRatePolicy,
): HostRatePolicy {
  if (!a) return b;
  return {
    requestsPerSecond: Math.min(a.requestsPerSecond, b.requestsPerSecond),
    burstSize: Math.min(a.burstSize, b.burstSize),
  };
}

/**
 * The lower-cased hostname without a trailing dot, or undefined for a URL
 * that does not parse. `fec.gov.` and `fec.gov` are one site; as two buckets
 * they would get twice its rate. A caller fetching an unparseable URL fails
 * at the fetch, which is where it should.
 */
export function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
    return host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Host policies for every {@link MemoryHostRateLimiter} in the process.
 *
 * Process-wide, like the Redis implementation's policy keys: the policy is
 * set by the region plugin service and must reach a limiter built in another
 * DI scope, or that limiter enforces the default against a host whose config
 * asks for less (the FEC API's 0.25 rps).
 *
 * Buckets are NOT shared — each instance keeps its own, as the limiter this
 * replaced did. Sharing them only mattered for two callers in one process
 * with no Redis, which is dev; and shared buckets broke isolation between
 * instances (tests), a throttled acquire from one resuming inside another.
 * Production and UAT run the Redis implementation, which shares both.
 *
 * The Redis implementation mirrors every policy it publishes here too, so
 * that when Redis is down it degrades to these — bounded, per process —
 * rather than to no throttling at all.
 */
let memoryPolicies = new Map<string, HostRatePolicy>();

/**
 * In-process {@link IHostRateLimiter}: dev and tests without Redis, and the
 * degraded mode of the Redis one. Buckets per instance, policies per process.
 */
export class MemoryHostRateLimiter implements IHostRateLimiter {
  private readonly buckets = new Map<
    string,
    { limiter: RateLimiter; policy: HostRatePolicy }
  >();

  constructor(private readonly fallback: HostRatePolicy) {}

  /**
   * Loops on the atomic `tryAcquire`, not `RateLimiter.acquire`: that one
   * computes a wait, sleeps, then takes a token unconditionally, so N
   * concurrent callers all wake together and fire at once — the race the
   * `HostThrottle` this replaced had been fixed for. Each wake re-checks.
   */
  async acquire(url: string): Promise<void> {
    const host = hostOf(url);
    if (!host) return;
    const bucket = this.bucketFor(host);
    while (!bucket.tryAcquire()) {
      await sleep(jittered(bucket.getWaitTimeMs()));
    }
  }

  async setPolicies(
    policies: ReadonlyMap<string, HostRatePolicy>,
  ): Promise<void> {
    memoryPolicies = new Map(
      [...policies].map(([host, p]) => [host, clampPolicy(p)]),
    );
  }

  /** Forget every process-wide policy. Tests only. */
  static resetPolicies(): void {
    memoryPolicies = new Map();
  }

  /** A host's bucket, rebuilt when its policy has changed since it was made. */
  private bucketFor(host: string): RateLimiter {
    const policy = memoryPolicies.get(host) ?? clampPolicy(this.fallback);
    const existing = this.buckets.get(host);
    if (existing && samePolicy(existing.policy, policy)) {
      return existing.limiter;
    }
    const limiter = new RateLimiter(policy);
    this.buckets.set(host, { limiter, policy });
    return limiter;
  }
}

/** Longest single wait; a waiter re-checks at least this often. */
const MAX_WAIT_MS = 60_000;

/**
 * A wait, bounded and jittered. Bounded so a corrupt value cannot become a
 * `setTimeout` overflow — which Node turns into 1ms, a spin. Jittered by up
 * to 10% so N waiters on one bucket do not all wake in the same millisecond
 * and race for a single token.
 */
export function jittered(waitMs: number): number {
  const ms = Number.isFinite(waitMs)
    ? Math.min(MAX_WAIT_MS, Math.max(1, waitMs))
    : MAX_WAIT_MS;
  return Math.ceil(ms * (1 + Math.random() * 0.1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function samePolicy(a: HostRatePolicy, b: HostRatePolicy): boolean {
  return (
    a.requestsPerSecond === b.requestsPerSecond && a.burstSize === b.burstSize
  );
}
