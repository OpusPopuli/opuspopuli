/**
 * @opuspopuli/region-provider
 *
 * Region provider implementations for the Opus Populi platform.
 * Supports pluggable data sources for civic information (propositions, meetings, representatives).
 *
 * Usage:
 * 1. Import RegionModule in your app module
 * 2. Set REGION_PROVIDER environment variable to select provider
 * 3. Inject RegionService to access civic data
 *
 * Creating custom providers:
 * 1. Create a new package implementing IRegionProvider
 * 2. Register in RegionModule.getProviderForRegion()
 * 3. Set REGION_PROVIDER=your-region in .env
 */

// Re-export types from common
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

// Provider implementations
export { ExampleRegionProvider } from "./providers/example.provider.js";

// Service and module
export { RegionService } from "./region.service.js";
export { RegionModule } from "./region.module.js";
