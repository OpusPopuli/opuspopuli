/**
 * Shared Redis utilities for the extraction-provider package.
 *
 * The retry strategy is identical across RedisCache and RedisRateLimiter.
 * Centralising it here eliminates the clone and ensures both classes
 * back off at the same rate.
 */

import Redis, { type RedisOptions } from "ioredis";

/**
 * Exponential back-off retry strategy capped at 2 s.
 * Returns null after 3 attempts so ioredis stops retrying.
 */
export function redisRetryStrategy(times: number): number | null {
  if (times > 3) return null;
  return Math.min(times * 200, 2000);
}

/**
 * Build a shared ioredis options object (retry strategy + timeouts).
 * Keeps the identical option blocks in the two Redis classes in sync.
 */
export function buildRedisOptions(opts: {
  lazyConnect?: boolean;
  connectTimeout?: number;
  maxRetriesPerRequest?: number;
}): Pick<
  RedisOptions,
  "lazyConnect" | "connectTimeout" | "maxRetriesPerRequest" | "retryStrategy"
> {
  return {
    lazyConnect: opts.lazyConnect ?? true,
    connectTimeout: opts.connectTimeout ?? 5000,
    maxRetriesPerRequest: opts.maxRetriesPerRequest ?? 3,
    retryStrategy: redisRetryStrategy,
  };
}

/**
 * Attach the standard connect/error/close event listeners that track
 * `isConnected` state. Eliminates the identical block in both RedisCache
 * and RedisRateLimiter constructors.
 */
export function attachConnectionListeners(
  redis: Redis,
  setConnected: (connected: boolean) => void,
): void {
  redis.on("connect", () => setConnected(true));
  redis.on("error", () => setConnected(false));
  redis.on("close", () => setConnected(false));
}

/**
 * Build a Redis client from url-or-host options and attach standard
 * connection listeners. Eliminates the duplicated constructor block
 * across RedisCache and RedisRateLimiter.
 */
export function createRedisClient(
  opts: {
    url?: string;
    host?: string;
    port?: number;
    lazyConnect?: boolean;
    connectTimeout?: number;
    maxRetriesPerRequest?: number;
  },
  setConnected: (connected: boolean) => void,
): Redis {
  const sharedOpts = buildRedisOptions({
    lazyConnect: opts.lazyConnect,
    connectTimeout: opts.connectTimeout,
    maxRetriesPerRequest: opts.maxRetriesPerRequest,
  });

  const redis = opts.url
    ? new Redis(opts.url, sharedOpts)
    : new Redis({
        host: opts.host ?? "localhost",
        port: opts.port ?? 6379,
        ...sharedOpts,
      });

  attachConnectionListeners(redis, setConnected);
  return redis;
}
