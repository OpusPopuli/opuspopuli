/**
 * HTTP Connection Pool Manager
 *
 * Provides HTTP connection pooling with keep-alive support using undici.
 * This significantly improves performance for repeated requests to the same origins
 * by reusing TCP connections instead of establishing new ones for each request.
 */

import { Agent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";
import {
  HttpPoolConfig,
  HttpPoolStats,
  IHttpPoolManager,
  PooledFetch,
  DEFAULT_HTTP_POOL_CONFIG,
} from "./types.js";

/**
 * HTTP Pool Manager
 *
 * Manages a connection pool for HTTP requests with keep-alive support.
 * Uses undici Agent under the hood for efficient connection reuse.
 */
export class HttpPoolManager implements IHttpPoolManager {
  private readonly agent: Agent;
  private readonly config: Required<HttpPoolConfig>;
  private closed = false;

  constructor(config: HttpPoolConfig = {}) {
    this.config = {
      ...DEFAULT_HTTP_POOL_CONFIG,
      ...config,
    };

    this.agent = new Agent({
      connections: this.config.connections,
      pipelining: this.config.pipelining,
      keepAliveTimeout: this.config.keepAliveTimeoutMs,
      keepAliveMaxTimeout: this.config.keepAliveMaxTimeoutMs,
      connect: {
        timeout: this.config.connectTimeoutMs,
      },
      bodyTimeout: this.config.bodyTimeoutMs || undefined,
      headersTimeout: this.config.headersTimeoutMs || undefined,
    });
  }

  /**
   * Get a fetch function that uses the connection pool
   */
  get fetch(): PooledFetch {
    return async (
      url: string | URL,
      options?: RequestInit,
    ): Promise<Response> => {
      if (this.closed) {
        throw new Error("HttpPoolManager has been closed");
      }

      // Use undici fetch with the pooled agent
      // Cast to avoid type conflict between different undici type packages
      const response = await fetch(url, {
        ...options,
        dispatcher: this.agent as unknown as RequestInit["dispatcher"],
      });

      return response;
    };
  }

  /**
   * Get pool statistics aggregated across all origins
   */
  getStats(): HttpPoolStats {
    const originStats = this.agent.stats;
    const aggregated: HttpPoolStats = {
      connected: 0,
      free: 0,
      pending: 0,
      queued: 0,
      running: 0,
      size: 0,
    };

    // Aggregate stats from all origins
    // Handle both ClientStats and PoolStats which have different properties
    for (const origin of Object.keys(originStats)) {
      const stats = originStats[origin] as unknown as Record<string, unknown>;

      // connected can be boolean (ClientStats) or number (PoolStats)
      if (typeof stats.connected === "number") {
        aggregated.connected += stats.connected;
      } else if (stats.connected === true) {
        aggregated.connected += 1;
      }

      // These properties may not exist on ClientStats
      if (typeof stats.free === "number") {
        aggregated.free += stats.free;
      }
      if (typeof stats.pending === "number") {
        aggregated.pending += stats.pending;
      }
      if (typeof stats.queued === "number") {
        aggregated.queued += stats.queued;
      }
      if (typeof stats.running === "number") {
        aggregated.running += stats.running;
      }
      if (typeof stats.size === "number") {
        aggregated.size += stats.size;
      }
    }

    return aggregated;
  }

  /**
   * Close all connections gracefully
   * Waits for pending requests to complete
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.agent.close();
  }

  /**
   * Destroy pool immediately
   * Does not wait for pending requests
   */
  async destroy(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.agent.destroy();
  }

  /**
   * Get the underlying undici agent
   * Useful for advanced configuration
   */
  getAgent(): Agent {
    return this.agent;
  }
}

// Singleton instance for shared pool
let sharedPool: HttpPoolManager | null = null;
/** Configuration the shared pool was actually created with, for the warning below. */
let sharedConfig: HttpPoolConfig | undefined;

/**
 * Get or create a shared HTTP pool manager
 * Use this for application-wide connection pooling
 */
export function getSharedHttpPool(config?: HttpPoolConfig): HttpPoolManager {
  if (!sharedPool) {
    sharedPool = new HttpPoolManager(config);
    sharedConfig = config;
    return sharedPool;
  }

  // The pool is memoised, so the FIRST caller's configuration wins and every
  // later one is discarded. That is fine when nobody disagrees and invisible
  // when somebody does: #1273 was three services running a 300s undici
  // headersTimeout while believing they had raised it, and a silently ignored
  // second call is the same failure wearing a different hat. Say so.
  // `sharedConfig ?? {}` matters: a pool created by a no-argument call stores
  // NO config, and gating the warning on a truthy `sharedConfig` would make
  // the most dangerous case the quietest one — defaults created first (undici's
  // 300s headersTimeout), then an explicit raise discarded in silence. That is
  // #1273 exactly. An empty active config honours nothing.
  if (config && !configHonoured(config, sharedConfig ?? {})) {
    console.warn(
      "[http-pool] Ignoring a differing HTTP pool configuration: the shared " +
        "pool was already created by an earlier caller. Configure it once, " +
        "before any fetch fires. " +
        `Ignored: ${describeConflicts(config, sharedConfig ?? {})}`,
    );
  }
  return sharedPool;
}

/** The settings this caller asked for that the active pool does not have. */
function describeConflicts(
  wanted: HttpPoolConfig,
  active: HttpPoolConfig,
): string {
  const a = active as Record<string, unknown>;
  return Object.entries(wanted as Record<string, unknown>)
    .filter(([key, value]) => value !== undefined && a[key] !== value)
    .map(([key, value]) => `${key}=${String(value)} (active ${String(a[key])})`)
    .join(", ");
}

/**
 * Is everything this caller asked for already true of the active pool?
 *
 * Compares only the keys the INCOMING config actually sets. An absent key is
 * "no opinion", not "set this to undefined" — and conflating the two made this
 * warning fire on every region boot, twice: `region/src/main.ts` configures
 * `headersTimeoutMs` AND `bodyTimeoutMs`, while `buildLane` asks for
 * `headersTimeoutMs` alone. A union-of-keys comparison called that a
 * disagreement and reported an ignored configuration when the value the caller
 * cared about was already exactly what it wanted.
 *
 * A warning that fires when nothing is wrong is worse than no warning: it
 * trains the reader to skip the line, which is precisely how #1273 stayed
 * invisible for three services in the first place.
 */
function configHonoured(
  wanted: HttpPoolConfig,
  active: HttpPoolConfig,
): boolean {
  const a = active as Record<string, unknown>;
  return Object.entries(wanted as Record<string, unknown>).every(
    ([key, value]) => value === undefined || a[key] === value,
  );
}

/**
 * Close the shared HTTP pool
 * Call this during graceful shutdown
 */
export async function closeSharedHttpPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.close();
    sharedPool = null;
  }
}

/**
 * Destroy the shared HTTP pool immediately
 * Call this for emergency shutdown
 */
export async function destroySharedHttpPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.destroy();
    sharedPool = null;
  }
}

/**
 * Set the global dispatcher for all fetch calls
 * This affects all native fetch() calls in the application
 *
 * @param config - Pool configuration
 */
export function setGlobalHttpPool(config?: HttpPoolConfig): Agent {
  const pool = getSharedHttpPool(config);
  setGlobalDispatcher(pool.getAgent());
  return pool.getAgent();
}

/**
 * Get the current global dispatcher
 */
export function getGlobalHttpDispatcher(): Dispatcher {
  return getGlobalDispatcher();
}

/**
 * Create a pooled fetch function for a specific configuration
 * Use this when you need different pool settings for different services
 *
 * @param config - Pool configuration
 * @returns Fetch function that uses the connection pool
 */
export function createPooledFetch(config?: HttpPoolConfig): PooledFetch {
  const pool = new HttpPoolManager(config);
  return pool.fetch;
}
