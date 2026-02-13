/**
 * @opuspopuli/region-plugin-sdk
 *
 * SDK for building Opus Populi region plugins.
 *
 * Plugin developers only need this package as a dependency.
 * It provides the IRegionPlugin interface, BaseRegionPlugin base class,
 * and all necessary types for civic data.
 *
 * Quick start:
 *   import { BaseRegionPlugin, CivicDataType } from '@opuspopuli/region-plugin-sdk';
 *
 *   export default class MyRegionPlugin extends BaseRegionPlugin {
 *     constructor() { super('my-region'); }
 *     // ... implement abstract methods
 *   }
 */

// Plugin interface and types
export type {
  IRegionPlugin,
  PluginHealth,
} from "./interfaces/plugin.interface.js";

// Base class for plugin developers
export { BaseRegionPlugin } from "./base/base-plugin.js";

// Re-export all civic data types from common
// so plugin developers only need @opuspopuli/region-plugin-sdk
export {
  IRegionProvider,
  RegionInfo,
  CivicDataType,
  PropositionStatus,
  Proposition,
  Meeting,
  Representative,
  ContactInfo,
  SyncResult,
  RegionError,
} from "@opuspopuli/common";
