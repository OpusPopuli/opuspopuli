/**
 * Cache module exports
 *
 * Core cache types (ICache, CacheOptions, MemoryCache) are now provided
 * by @opuspopuli/common. Re-exported here for backwards compatibility.
 */

// Re-export from common
export { ICache, CacheOptions, MemoryCache } from "@opuspopuli/common";

// Local implementations (Redis-specific, stays in extraction-provider)
export * from "./redis-cache.js";
export * from "./cache-factory.js";
