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

// Region config discovery
export { discoverRegionConfigs } from "./loader/region-config-discovery.js";
export type { RegionPluginFile } from "./loader/region-config-discovery.js";
