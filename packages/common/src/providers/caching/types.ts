/**
 * Caching Types
 *
 * Types and interfaces for cache implementations.
 */

/**
 * Configuration options for the in-memory cache
 */
export interface CacheOptions {
  /** Time-to-live in milliseconds for cache entries (default: 300000 = 5 min) */
  ttlMs?: number;
  /** Maximum number of entries in the cache (default: 100) */
  maxSize?: number;
}

/**
 * Cache interface for key-value storage with TTL support
 */
export interface ICache<T = string> {
  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns The cached value or undefined if not found/expired
   */
  get(key: string): Promise<T | undefined> | T | undefined;

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional TTL override in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): Promise<void> | void;

  /**
   * Check if a key exists and is not expired
   * @param key Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): Promise<boolean> | boolean;

  /**
   * Delete a key from the cache
   * @param key Cache key
   * @returns True if key was deleted
   */
  delete(key: string): Promise<boolean> | boolean;

  /**
   * Clear all entries from the cache
   */
  clear(): Promise<void> | void;

  /**
   * Get the current number of entries
   */
  readonly size: number | Promise<number>;

  /**
   * Get all keys in the cache
   */
  keys(): Promise<string[]> | string[];

  /**
   * Cleanup resources (call on module destroy)
   */
  destroy(): Promise<void> | void;
}
