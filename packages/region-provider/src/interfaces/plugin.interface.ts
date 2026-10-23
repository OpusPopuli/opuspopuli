/**
 * Region Plugin Interface
 *
 * Extends IRegionProvider with lifecycle hooks for the plugin ecosystem.
 */

import type {
  BoundarySourcesConfig,
  IRegionProvider,
} from "@opuspopuli/common";

/**
 * Plugin health status returned by healthCheck()
 */
export interface PluginHealth {
  healthy: boolean;
  message?: string;
  lastCheck: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Region plugin interface with lifecycle hooks.
 *
 * Extends the base IRegionProvider with:
 * - initialize(): Called once when the plugin is loaded
 * - healthCheck(): Called periodically to verify the plugin is operational
 * - destroy(): Called when the plugin is being unloaded
 * - getVersion(): Returns the plugin version for compatibility tracking
 */
export interface IRegionPlugin extends IRegionProvider {
  /**
   * Initialize the plugin with optional configuration.
   * Called once when the plugin is loaded by the platform.
   * Use this to set up API clients, validate config, etc.
   */
  initialize(config?: Record<string, unknown>): Promise<void>;

  /**
   * Health check for monitoring.
   * Called periodically to verify the plugin is operational.
   * Return healthy: false if data sources are unreachable.
   */
  healthCheck(): Promise<PluginHealth>;

  /**
   * Cleanup resources when the plugin is being unloaded.
   * Called on shutdown or when the plugin is disabled.
   * Use this to close connections, flush caches, etc.
   */
  destroy(): Promise<void>;

  /**
   * Get the plugin version (semver).
   * Used for compatibility tracking and diagnostics.
   */
  getVersion(): string;

  /**
   * Return the region's civic-boundary geometry sources, if any.
   *
   * Optional — only plugins backing a region with public boundary data
   * (TIGER counties, ArcGIS FeatureServer special districts, etc.) supply
   * this. The consumer's BoundaryLoaderService reads the returned block,
   * dispatches to TIGER and Geoportal fetchers, and upserts on
   * fipsCode/ocdId.
   *
   * Returning `undefined` is the correct shape for plugins that don't
   * declare `boundarySources` in their config (federal, plugins backed by
   * incomplete data, etc.) — addresses in those regions still resolve via
   * Census Geocoder string fields, but PostGIS point-in-polygon queries
   * return no matches against jurisdictions populated by this loader.
   *
   * See opuspopuli#804 + opuspopuli-regions#51.
   */
  getBoundarySources?(): BoundarySourcesConfig | undefined;

  /**
   * The region config's `rateLimit` — the fetch rate its sources' hosts
   * should see (S1, `docs/plans/S1-per-host-rate-limiter.md`).
   *
   * Optional: a plugin with no config, or a config that declares none,
   * returns undefined and its hosts get the global default. Declared in
   * region configs and validated long before anything read it; federal's
   * 0.25 rps is the FEC API's quota.
   */
  getRateLimit?(): { requestsPerSecond: number; burstSize: number } | undefined;
}
