/**
 * HTTP Connection Pool Types
 *
 * Configuration types for HTTP connection pooling with keep-alive support.
 */

/**
 * Configuration for HTTP connection pool
 */
export interface HttpPoolConfig {
  /**
   * Maximum number of connections per origin
   * @default 100
   */
  connections?: number;

  /**
   * Maximum number of requests that can be pipelined
   * @default 10
   */
  pipelining?: number;

  /**
   * Keep-alive timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  keepAliveTimeoutMs?: number;

  /**
   * Maximum keep-alive duration in milliseconds
   * @default 600000 (10 minutes)
   */
  keepAliveMaxTimeoutMs?: number;

  /**
   * Connection timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  connectTimeoutMs?: number;

  /**
   * Request timeout in milliseconds (0 = no timeout)
   * @default 0
   */
  bodyTimeoutMs?: number;

  /**
   * Headers timeout in milliseconds (0 = no timeout)
   * @default 0
   */
  headersTimeoutMs?: number;
}

/**
 * Default HTTP pool configuration optimized for production use
 */
export const DEFAULT_HTTP_POOL_CONFIG: Required<HttpPoolConfig> = {
  connections: 100,
  pipelining: 10,
  keepAliveTimeoutMs: 30000,
  keepAliveMaxTimeoutMs: 600000,
  connectTimeoutMs: 30000,
  bodyTimeoutMs: 0,
  headersTimeoutMs: 0,
};

/**
 * HTTP pool statistics
 */
export interface HttpPoolStats {
  /** Number of connected sockets */
  connected: number;
  /** Number of free sockets */
  free: number;
  /** Number of pending requests */
  pending: number;
  /** Number of queued requests */
  queued: number;
  /** Number of running requests */
  running: number;
  /** Total size of pool */
  size: number;
}

/**
 * Pooled fetch function signature
 */
export type PooledFetch = (
  url: string | URL,
  options?: RequestInit,
) => Promise<Response>;

/**
 * HTTP pool manager interface
 */
export interface IHttpPoolManager {
  /**
   * Get the pooled fetch function
   */
  fetch: PooledFetch;

  /**
   * Get pool statistics
   */
  getStats(): HttpPoolStats;

  /**
   * Close all connections gracefully
   */
  close(): Promise<void>;

  /**
   * Destroy pool immediately
   */
  destroy(): Promise<void>;
}
