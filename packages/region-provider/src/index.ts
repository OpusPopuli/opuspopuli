/**
 * @opuspopuli/region-provider
 *
 * Region provider implementations for the Opus Populi platform.
 * Supports pluggable data sources for civic information (propositions, meetings, representatives).
 *
 * Usage (recommended - plugin mode):
 * 1. Import RegionModule.forPlugins() in your app module
 * 2. Configure the region plugin in the region_plugins database table
 * 3. The domain service loads the plugin at startup
 *
 * Usage (legacy - env var mode):
 * 1. Import RegionModule.forRootAsync() in your app module
 * 2. Set REGION_PROVIDER environment variable
 * 3. Inject RegionService to access civic data
 */

// Re-export types from common
export {
  IRegionProvider,
  RegionInfo,
  DataType,
  PropositionStatus,
  Proposition,
  Meeting,
  Representative,
  ContactInfo,
  SyncResult,
  SyncDepth,
  RegionError,
} from "@opuspopuli/common";

// Plugin interfaces (formerly @opuspopuli/region-plugin-sdk)
export type {
  IRegionPlugin,
  PluginHealth,
} from "./interfaces/plugin.interface.js";
export { BaseRegionPlugin } from "./base/base-plugin.js";

// Provider implementations
export { ExampleRegionProvider } from "./providers/example.provider.js";

// Service and module
export { RegionService } from "./region.service.js";
export { RegionModule } from "./region.module.js";

// Plugin infrastructure
export { PluginRegistryService } from "./registry/plugin-registry.service.js";
export type { RegisteredPlugin } from "./registry/plugin-registry.service.js";
export { PluginLoaderService } from "./loader/plugin-loader.service.js";
export type { PluginDefinition } from "./loader/plugin-loader.service.js";

// Declarative plugin support
export { DeclarativeRegionPlugin } from "./declarative/declarative-region-plugin.js";
export type { IPipelineService } from "./declarative/declarative-region-plugin.js";

// Boundary-loader schema types re-exported from @opuspopuli/common (which
// mirrors the @opuspopuli/regions JSON schema) so backend consumers
// (BoundaryLoaderService and its fetchers) have a single import surface
// alongside the rest of the plugin types. See opuspopuli#804.
export type {
  BoundarySourcesConfig,
  TigerLayerConfig,
  GeoportalLayerConfig,
  BoundaryJurisdictionType,
  BoundaryJurisdictionLevel,
} from "@opuspopuli/common";

// Region config discovery
export { discoverRegionConfigs } from "./loader/region-config-discovery.js";
export type { RegionPluginFile } from "./loader/region-config-discovery.js";

// Region configs directory (from @opuspopuli/regions package)
import { join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Returns the absolute path to the regions/ directory from @opuspopuli/regions.
 *
 * Walks up from this file to find `node_modules/@opuspopuli/regions/regions/`,
 * which means it resolves whichever copy is NEAREST — and under pnpm's isolated
 * layout that is the one THIS package declares, not the one any consumer
 * declares. That is not a detail: on 2026-09-24 `apps/backend` was bumped to
 * regions 1.0.97 while this package still pinned 1.0.96, the image carried both,
 * and the walk below silently served the older config. Every other signal
 * reported success (#1328). `apps/backend` no longer declares regions at all;
 * this package owns the single pin, so the walk has one answer.
 *
 * Throws rather than returning a path that does not exist. The previous version
 * fell back to an in-tree `../regions` that IS NOT PRESENT in this package, so a
 * missing install produced a bogus absolute path, and the caller discovered zero
 * configs and reported no error — a region service running with no regions.
 */
export function getRegionsDir(): string {
  // Walk up the directory tree looking for the installed package
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(
      dir,
      "node_modules",
      "@opuspopuli",
      "regions",
      "regions",
    );
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Kept for test environments that vendor configs beside the package, but
  // only when it is really there.
  const inTree = join(__dirname, "..", "regions");
  if (existsSync(inTree)) return inTree;

  throw new Error(
    "@opuspopuli/regions is not installed: no " +
      "node_modules/@opuspopuli/regions/regions found walking up from " +
      `${__dirname}, and no in-tree fallback at ${inTree}. ` +
      "Region config cannot load. Run an install, and check that " +
      "packages/region-provider declares @opuspopuli/regions (see #1328).",
  );
}
