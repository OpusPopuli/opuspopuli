/**
 * Base Region Plugin
 *
 * Abstract base class for region plugins.
 * Provides default lifecycle implementations so plugin developers
 * only need to implement the data-fetching methods.
 *
 * Usage:
 *   export class CaliforniaRegionPlugin extends BaseRegionPlugin {
 *     constructor() { super('california'); }
 *     getName() { return 'california'; }
 *     getVersion() { return '0.1.0'; }
 *     // ... implement abstract methods
 *   }
 */

import { Logger } from "@nestjs/common";
import type {
  RegionInfo,
  CivicDataType,
  Proposition,
  Meeting,
  Representative,
} from "@opuspopuli/common";
import type {
  IRegionPlugin,
  PluginHealth,
} from "../interfaces/plugin.interface.js";

export abstract class BaseRegionPlugin implements IRegionPlugin {
  protected readonly logger: Logger;
  protected config?: Record<string, unknown>;
  protected initialized = false;

  constructor(protected readonly pluginName: string) {
    this.logger = new Logger(`RegionPlugin:${pluginName}`);
  }

  // Abstract methods that plugin developers must implement
  abstract getName(): string;
  abstract getVersion(): string;
  abstract getRegionInfo(): RegionInfo;
  abstract getSupportedDataTypes(): CivicDataType[];
  abstract fetchPropositions(): Promise<Proposition[]>;
  abstract fetchMeetings(): Promise<Meeting[]>;
  abstract fetchRepresentatives(): Promise<Representative[]>;

  /**
   * Initialize the plugin. Override to add custom setup logic.
   */
  async initialize(config?: Record<string, unknown>): Promise<void> {
    this.logger.log(`Initializing plugin: ${this.pluginName}`);
    this.config = config;
    this.initialized = true;
  }

  /**
   * Default health check. Override for custom health monitoring.
   */
  async healthCheck(): Promise<PluginHealth> {
    return {
      healthy: this.initialized,
      message: this.initialized
        ? "Plugin operational"
        : "Plugin not initialized",
      lastCheck: new Date(),
    };
  }

  /**
   * Cleanup on unload. Override to close connections, flush caches, etc.
   */
  async destroy(): Promise<void> {
    this.logger.log(`Destroying plugin: ${this.pluginName}`);
    this.initialized = false;
  }
}
