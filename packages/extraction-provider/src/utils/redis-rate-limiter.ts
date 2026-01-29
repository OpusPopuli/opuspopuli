/**
 * Redis Rate Limiter using Token Bucket Algorithm
 *
 * Distributed rate limiter using Redis for multi-instance deployments.
 * Provides consistent rate limiting across all service instances.
 *
 * Uses a Lua script to atomically check and decrement tokens.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/208
 */

import Redis from "ioredis";
import type { IRateLimiter } from "../cache/cache.interface.js";
import type { RateLimitOptions } from "../types.js";

/**
 * Redis rate limiter configuration options
 */
export interface RedisRateLimiterOptions extends RateLimitOptions {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url?: string;
  /** Redis host (default: localhost) */
  host?: string;
  /** Redis port (default: 6379) */
  port?: number;
  /** Key for this rate limiter (default: 'ratelimit:default') */
  key?: string;
  /** Enable lazy connect (default: true) */
  lazyConnect?: boolean;
}

/**
 * Lua script for atomic token bucket operations
 * Returns: [tokens_remaining, wait_time_ms]
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

-- Get current state
local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or burst
local last_refill = tonumber(data[2]) or now

-- Calculate token refill
local elapsed = now - last_refill
local tokens_to_add = elapsed * rate / 1000
tokens = math.min(burst, tokens + tokens_to_add)

-- Check if we can satisfy the request
if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('PEXPIRE', key, 60000) -- Expire after 1 minute of inactivity
  return {tokens, 0}
else
  -- Calculate wait time
  local tokens_needed = requested - tokens
  local wait_ms = math.ceil(tokens_needed * 1000 / rate)
  return {tokens, wait_ms}
end
`;

/**
 * Redis-based distributed rate limiter using token bucket algorithm
 */
export class RedisRateLimiter implements IRateLimiter {
  private readonly redis: Redis;
  private readonly requestsPerSecond: number;
  private readonly burstSize: number;
  private readonly key: string;
  private isConnected: boolean = false;
  private lastError?: unknown;

  constructor(options: RedisRateLimiterOptions = {}) {
    this.requestsPerSecond = options.requestsPerSecond ?? 2;
    this.burstSize = options.burstSize ?? 5;
    this.key = options.key ?? "ratelimit:default";

    // Parse URL or use host/port
    if (options.url) {
      this.redis = new Redis(options.url, {
        lazyConnect: options.lazyConnect ?? true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
    } else {
      this.redis = new Redis({
        host: options.host ?? "localhost",
        port: options.port ?? 6379,
        lazyConnect: options.lazyConnect ?? true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
    }

    // Track connection state
    this.redis.on("connect", () => {
      this.isConnected = true;
    });

    this.redis.on("error", () => {
      this.isConnected = false;
    });

    this.redis.on("close", () => {
      this.isConnected = false;
    });

    // Define the Lua script
    this.redis.defineCommand("tokenBucket", {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_SCRIPT,
    });
  }

  /**
   * Ensure connection is established
   */
  private async ensureConnected(): Promise<void> {
    if (!this.isConnected && this.redis.status === "wait") {
      await this.redis.connect();
    }
  }

  /**
   * Acquire a token, waiting if necessary
   */
  async acquire(): Promise<void> {
    try {
      await this.ensureConnected();
      const now = Date.now();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.redis as any).tokenBucket(
        this.key,
        now,
        this.requestsPerSecond,
        this.burstSize,
        1,
      );

      const waitMs = result[1];
      if (waitMs > 0) {
        await this.sleep(waitMs);
        // After waiting, try again (token should be available now)
        await this.acquire();
      }
    } catch (error) {
      this.lastError = error; // Fail-open: allow request on Redis error
      return;
    }
  }

  /**
   * Try to acquire a token without waiting
   */
  async tryAcquire(): Promise<boolean> {
    try {
      await this.ensureConnected();
      const now = Date.now();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.redis as any).tokenBucket(
        this.key,
        now,
        this.requestsPerSecond,
        this.burstSize,
        1,
      );

      return result[1] === 0;
    } catch (error) {
      this.lastError = error; // Fail-open: allow request on Redis error
      return true;
    }
  }

  /**
   * Get the time in milliseconds until the next token is available
   */
  async getWaitTimeMs(): Promise<number> {
    try {
      await this.ensureConnected();
      const now = Date.now();

      // Use 0 tokens requested to just check state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.redis as any).tokenBucket(
        this.key,
        now,
        this.requestsPerSecond,
        this.burstSize,
        0,
      );

      const tokens = result[0];
      if (tokens >= 1) {
        return 0;
      }

      const tokensNeeded = 1 - tokens;
      return Math.ceil((tokensNeeded * 1000) / this.requestsPerSecond);
    } catch (error) {
      this.lastError = error; // Fail-open: return 0 wait time on error
      return 0;
    }
  }

  /**
   * Get the current number of available tokens
   */
  async getAvailableTokens(): Promise<number> {
    try {
      await this.ensureConnected();
      const data = await this.redis.hmget(this.key, "tokens", "last_refill");
      const tokens = parseFloat(data[0] ?? String(this.burstSize));
      const lastRefill = parseInt(data[1] ?? String(Date.now()), 10);

      // Calculate current tokens with refill
      const elapsed = Date.now() - lastRefill;
      const tokensToAdd = (elapsed * this.requestsPerSecond) / 1000;
      return Math.min(this.burstSize, tokens + tokensToAdd);
    } catch (error) {
      this.lastError = error; // Fail-open: assume full tokens on error
      return this.burstSize;
    }
  }

  /**
   * Reset the limiter to its initial state
   */
  async reset(): Promise<void> {
    try {
      await this.ensureConnected();
      await this.redis.del(this.key);
    } catch (error) {
      this.lastError = error; // Fail-open: ignore reset errors
    }
  }

  /**
   * Close Redis connection
   */
  async destroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.lastError = error; // Fallback to disconnect on quit failure
      this.redis.disconnect();
    }
    this.isConnected = false;
  }

  /**
   * Get the last error that occurred (useful for debugging)
   */
  getLastError(): unknown {
    return this.lastError;
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected && this.redis.status === "ready";
  }

  /**
   * Sleep for the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
