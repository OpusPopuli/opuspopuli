/**
 * Cache Interface
 *
 * Common interface for cache implementations (Memory, Redis).
 * Enables switching between implementations without changing consumer code.
 */

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

/**
 * Rate limiter interface for distributed rate limiting
 */
export interface IRateLimiter {
  /**
   * Acquire a token, waiting if necessary
   * @returns Promise that resolves when a token is available
   */
  acquire(): Promise<void>;

  /**
   * Try to acquire a token without waiting
   * @returns True if token was acquired, false otherwise
   */
  tryAcquire(): Promise<boolean> | boolean;

  /**
   * Get the time in milliseconds until the next token is available
   * @returns 0 if a token is immediately available
   */
  getWaitTimeMs(): Promise<number> | number;

  /**
   * Get the current number of available tokens
   */
  getAvailableTokens(): Promise<number> | number;

  /**
   * Reset the limiter to its initial state
   */
  reset(): Promise<void> | void;
}
