/**
 * HTTP Connection Pool Module
 *
 * Provides HTTP connection pooling with keep-alive support for improved
 * performance when making repeated requests to the same origins.
 *
 * @example
 * ```typescript
 * import { getSharedHttpPool, setGlobalHttpPool } from '@qckstrt/common';
 *
 * // Option 1: Use shared pool directly
 * const pool = getSharedHttpPool();
 * const response = await pool.fetch('https://api.example.com/data');
 *
 * // Option 2: Set global dispatcher for all fetch calls
 * setGlobalHttpPool({ connections: 50 });
 * const response = await fetch('https://api.example.com/data'); // Uses pool automatically
 *
 * // Option 3: Create isolated pool for specific service
 * const ollamaPool = new HttpPoolManager({ connections: 10 });
 * const response = await ollamaPool.fetch('http://localhost:11434/api/generate');
 * ```
 */

export {
  HttpPoolManager,
  getSharedHttpPool,
  closeSharedHttpPool,
  destroySharedHttpPool,
  setGlobalHttpPool,
  getGlobalHttpDispatcher,
  createPooledFetch,
} from "./http-pool.js";

export type {
  HttpPoolConfig,
  HttpPoolStats,
  IHttpPoolManager,
  PooledFetch,
} from "./types.js";

export { DEFAULT_HTTP_POOL_CONFIG } from "./types.js";
