/**
 * Redis Cache Implementation
 *
 * Distributed cache using Redis for multi-instance deployments.
 * Provides consistent caching across all service instances.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/208
 */

import Redis from "ioredis";
import type { ICache } from "./cache.interface.js";
import type { CacheOptions } from "../types.js";

/**
 * Redis cache configuration options
 */
export interface RedisCacheOptions extends CacheOptions {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url?: string;
  /** Redis host (default: localhost) */
  host?: string;
  /** Redis port (default: 6379) */
  port?: number;
  /** Key prefix for namespacing (default: 'cache:') */
  keyPrefix?: string;
  /** Enable lazy connect (default: true) */
  lazyConnect?: boolean;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Max retries per request (default: 3) */
  maxRetriesPerRequest?: number;
}

/**
 * Redis-based distributed cache implementation
 */
export class RedisCache<T = string> implements ICache<T> {
  private readonly redis: Redis;
  private readonly ttlMs: number;
  private readonly keyPrefix: string;
  private isConnected: boolean = false;
  private lastError?: unknown;

  constructor(options: RedisCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 300000; // 5 minutes default
    this.keyPrefix = options.keyPrefix ?? "cache:";

    // Parse URL or use host/port
    if (options.url) {
      this.redis = new Redis(options.url, {
        lazyConnect: options.lazyConnect ?? true,
        connectTimeout: options.connectTimeout ?? 5000,
        maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
        retryStrategy: (times) => {
          if (times > 3) return null; // Stop retrying after 3 attempts
          return Math.min(times * 200, 2000);
        },
      });
    } else {
      this.redis = new Redis({
        host: options.host ?? "localhost",
        port: options.port ?? 6379,
        lazyConnect: options.lazyConnect ?? true,
        connectTimeout: options.connectTimeout ?? 5000,
        maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
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
   * Get full key with prefix
   */
  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Get a value from Redis cache
   */
  async get(key: string): Promise<T | undefined> {
    try {
      await this.ensureConnected();
      const data = await this.redis.get(this.getKey(key));
      if (!data) return undefined;
      return JSON.parse(data) as T;
    } catch (error) {
      this.lastError = error; // Fail-open: cache is best-effort
      return undefined;
    }
  }

  /**
   * Set a value in Redis cache
   */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      await this.ensureConnected();
      const ttlSeconds = Math.ceil((ttlMs ?? this.ttlMs) / 1000);
      await this.redis.setex(
        this.getKey(key),
        ttlSeconds,
        JSON.stringify(value),
      );
    } catch (error) {
      this.lastError = error; // Fail-open: cache is best-effort
    }
  }

  /**
   * Check if a key exists in Redis
   */
  async has(key: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const exists = await this.redis.exists(this.getKey(key));
      return exists === 1;
    } catch (error) {
      this.lastError = error; // Fail-open: cache is best-effort
      return false;
    }
  }

  /**
   * Delete a key from Redis
   */
  async delete(key: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const deleted = await this.redis.del(this.getKey(key));
      return deleted === 1;
    } catch (error) {
      this.lastError = error; // Fail-open: cache is best-effort
      return false;
    }
  }

  /**
   * Clear all keys with the prefix
   */
  async clear(): Promise<void> {
    try {
      await this.ensureConnected();
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.lastError = error; // Fail-open: cache is best-effort
    }
  }

  /**
   * Get count of keys with prefix
   */
  get size(): Promise<number> {
    return (async () => {
      try {
        await this.ensureConnected();
        const keys = await this.redis.keys(`${this.keyPrefix}*`);
        return keys.length;
      } catch (error) {
        this.lastError = error; // Fail-open: cache is best-effort
        return 0;
      }
    })();
  }

  /**
   * Get all keys (without prefix)
   */
  async keys(): Promise<string[]> {
    try {
      await this.ensureConnected();
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      return keys.map((k) => k.slice(this.keyPrefix.length));
    } catch (error) {
      this.lastError = error; // Fail-open: cache is best-effort
      return [];
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
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected && this.redis.status === "ready";
  }

  /**
   * Ping Redis to check health
   */
  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      this.lastError = error; // Fail-open: return false on connection error
      return false;
    }
  }

  /**
   * Get the last error that occurred (useful for debugging)
   */
  getLastError(): unknown {
    return this.lastError;
  }
}
