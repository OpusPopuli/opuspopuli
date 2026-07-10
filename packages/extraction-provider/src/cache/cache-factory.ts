/**
 * Cache Factory
 *
 * Creates cache and rate limiter instances based on configuration.
 * Supports Redis for distributed caching with automatic fallback to memory.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/208
 */

import { Logger } from "@nestjs/common";
import type {
  ICache,
  IRateLimiter,
  CacheOptions,
  RateLimitOptions,
} from "@opuspopuli/common";
import { MemoryCache, RateLimiter } from "@opuspopuli/common";
import { RedisCache, type RedisCacheOptions } from "./redis-cache.js";
import {
  RedisRateLimiter,
  type RedisRateLimiterOptions,
} from "../utils/redis-rate-limiter.js";

/**
 * Cache provider type
 */
export type CacheProvider = "memory" | "redis";

/**
 * Factory configuration
 */
export interface CacheFactoryConfig {
  /** Cache provider to use */
  provider: CacheProvider;
  /** Redis URL (required for redis provider) */
  redisUrl?: string;
  /** Cache options */
  cacheOptions?: CacheOptions;
  /** Rate limit options */
  rateLimitOptions?: RateLimitOptions;
  /** Key prefix for Redis (default: service name or 'extraction') */
  keyPrefix?: string;
  /** Rate limiter key (default: 'ratelimit:extraction') */
  rateLimiterKey?: string;
}

/**
 * Factory for creating cache and rate limiter instances
 */
export class CacheFactory {
  private static readonly logger = new Logger(CacheFactory.name);

  /**
   * Create a cache instance based on configuration
   */
  static createCache<T = string>(config: CacheFactoryConfig): ICache<T> {
    if (config.provider === "redis" && config.redisUrl) {
      try {
        const redisOptions: RedisCacheOptions = {
          url: config.redisUrl,
          keyPrefix: config.keyPrefix ?? "extraction:cache:",
          ...config.cacheOptions,
        };
        const cache = new RedisCache<T>(redisOptions);
        this.logger.log("Created Redis cache instance");
        return cache;
      } catch (error) {
        this.logger.warn(
          `Failed to create Redis cache, falling back to memory: ${error}`,
        );
        return new MemoryCache<T>(config.cacheOptions);
      }
    }

    this.logger.log("Created memory cache instance");
    return new MemoryCache<T>(config.cacheOptions);
  }

  /**
   * Create a rate limiter instance based on configuration
   */
  static createRateLimiter(config: CacheFactoryConfig): IRateLimiter {
    if (config.provider === "redis" && config.redisUrl) {
      try {
        const redisOptions: RedisRateLimiterOptions = {
          url: config.redisUrl,
          key: config.rateLimiterKey ?? "ratelimit:extraction",
          ...config.rateLimitOptions,
        };
        const limiter = new RedisRateLimiter(redisOptions);
        this.logger.log("Created Redis rate limiter instance");
        return limiter;
      } catch (error) {
        this.logger.warn(
          `Failed to create Redis rate limiter, falling back to memory: ${error}`,
        );
        return new RateLimiter(config.rateLimitOptions);
      }
    }

    this.logger.log("Created memory rate limiter instance");
    return new RateLimiter(config.rateLimitOptions);
  }

  /**
   * Determine provider from environment
   */
  static getProviderFromEnv(): CacheProvider {
    // Either the dedicated cache URL or the shared queue URL enables redis.
    if (process.env.REDIS_CACHE_URL || process.env.REDIS_URL) {
      return "redis";
    }
    return "memory";
  }

  /**
   * Get Redis URL for the application CACHE from environment.
   *
   * Prefers REDIS_CACHE_URL (the dedicated allkeys-lru cache instance, #725),
   * falling back to REDIS_URL (the BullMQ noeviction instance) when it isn't
   * set — so deployments that haven't split Redis yet keep working unchanged.
   * BullMQ itself always reads REDIS_URL directly and is unaffected.
   */
  static getRedisUrlFromEnv(): string | undefined {
    return process.env.REDIS_CACHE_URL ?? process.env.REDIS_URL;
  }

  /**
   * Create default configuration from environment
   */
  static createConfigFromEnv(
    overrides?: Partial<CacheFactoryConfig>,
  ): CacheFactoryConfig {
    return {
      provider: overrides?.provider ?? this.getProviderFromEnv(),
      redisUrl: overrides?.redisUrl ?? this.getRedisUrlFromEnv(),
      ...overrides,
    };
  }
}

/**
 * Wrapper that provides fallback behavior for cache operations
 */
export class FallbackCache<T = string> implements ICache<T> {
  private readonly logger = new Logger(FallbackCache.name);
  private readonly primary: ICache<T>;
  private readonly fallback: ICache<T>;
  private readonly retryAfterMs: number;
  private useFallback: boolean = false;
  private lastFailureAt: number = 0;

  /**
   * @param retryAfterMs once the primary has failed and we're serving from the
   *   in-memory fallback, wait at least this long before probing the primary
   *   again. Prevents a brief Redis outage from pinning the cache to memory
   *   permanently (the old behavior required a manual resetToPrimary()).
   */
  constructor(primary: ICache<T>, fallback: ICache<T>, retryAfterMs = 30_000) {
    this.primary = primary;
    this.fallback = fallback;
    this.retryAfterMs = retryAfterMs;
  }

  private async withFallback<R>(
    operation: () => Promise<R> | R,
    fallbackOperation: () => Promise<R> | R,
  ): Promise<R> {
    if (this.useFallback && !this.shouldProbePrimary()) {
      return fallbackOperation();
    }

    try {
      const result = await operation();
      if (this.useFallback) {
        this.logger.log(
          "Primary cache recovered, switching back from fallback",
        );
        this.useFallback = false;
      }
      return result;
    } catch (error) {
      if (!this.useFallback) {
        this.logger.warn(
          `Primary cache failed, switching to fallback: ${error}`,
        );
        this.useFallback = true;
      }
      this.lastFailureAt = Date.now();
      return fallbackOperation();
    }
  }

  /** True once the fallback cooldown has elapsed and it's time to re-probe. */
  private shouldProbePrimary(): boolean {
    return Date.now() - this.lastFailureAt >= this.retryAfterMs;
  }

  async get(key: string): Promise<T | undefined> {
    return this.withFallback(
      () => this.primary.get(key),
      () => this.fallback.get(key),
    );
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    return this.withFallback(
      () => this.primary.set(key, value, ttlMs),
      () => this.fallback.set(key, value, ttlMs),
    );
  }

  async has(key: string): Promise<boolean> {
    return this.withFallback(
      () => this.primary.has(key),
      () => this.fallback.has(key),
    );
  }

  async delete(key: string): Promise<boolean> {
    return this.withFallback(
      () => this.primary.delete(key),
      () => this.fallback.delete(key),
    );
  }

  async clear(): Promise<void> {
    return this.withFallback(
      () => this.primary.clear(),
      () => this.fallback.clear(),
    );
  }

  get size(): Promise<number> {
    if (this.useFallback) {
      const s = this.fallback.size;
      return Promise.resolve(s instanceof Promise ? s : s);
    }
    const s = this.primary.size;
    return Promise.resolve(s instanceof Promise ? s : s);
  }

  async keys(): Promise<string[]> {
    return this.withFallback(
      () => this.primary.keys(),
      () => this.fallback.keys(),
    );
  }

  async destroy(): Promise<void> {
    await Promise.all([this.primary.destroy(), this.fallback.destroy()]);
  }

  /**
   * Check if using fallback
   */
  isUsingFallback(): boolean {
    return this.useFallback;
  }

  /**
   * Reset to primary (for recovery). Rarely needed now that withFallback()
   * auto-probes the primary after retryAfterMs; kept for explicit control.
   */
  resetToPrimary(): void {
    this.useFallback = false;
    this.lastFailureAt = 0;
  }
}
