import { Injectable, Logger } from "@nestjs/common";
import type { IRegionPlugin } from "../interfaces/plugin.interface.js";
import type { DeclarativeRegionConfig } from "@opuspopuli/common";
import { PluginRegistryService } from "../registry/plugin-registry.service.js";
import {
  DeclarativeRegionPlugin,
  type IPipelineService,
} from "../declarative/declarative-region-plugin.js";

export interface PluginDefinition {
  name: string;
  config?: Record<string, unknown>;
}

/**
 * Plugin Loader
 *
 * Loads declarative region plugins from JSON config + scraping pipeline.
 * Supports loading both a local plugin (user-selected region) and the
 * federal plugin (always loaded for FEC data).
 */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(private readonly registry: PluginRegistryService) {}

  /**
   * Load a local declarative plugin and register it.
   *
   * Wraps a DeclarativeRegionConfig with the ScrapingPipelineService
   * to provide the IRegionPlugin interface.
   */
  async loadPlugin(
    definition: PluginDefinition,
    pipeline?: IPipelineService,
  ): Promise<IRegionPlugin> {
    const { name, config } = definition;

    if (!pipeline) {
      throw new Error(
        `Cannot load declarative plugin "${name}": ScrapingPipelineService is not available. ` +
          `Ensure ScrapingPipelineModule is imported and SCRAPING_PIPELINE is provided.`,
      );
    }

    this.logger.log(`Loading declarative plugin "${name}"`);

    const regionConfig = config as unknown as DeclarativeRegionConfig;

    if (!regionConfig?.regionId || !regionConfig?.dataSources) {
      throw new Error(
        `Declarative plugin "${name}" requires a valid DeclarativeRegionConfig with regionId and dataSources`,
      );
    }

    const plugin = new DeclarativeRegionPlugin(regionConfig, pipeline);
    await this.registry.registerLocal(name, plugin, config);

    this.logger.log(
      `Declarative plugin "${name}" loaded (v${plugin.getVersion()}, ${regionConfig.dataSources.length} data sources)`,
    );
    return plugin;
  }

  /**
   * Load the federal plugin and register it in the federal slot.
   * The federal plugin is always loaded — it provides FEC campaign finance
   * data scoped to the active local region's state.
   */
  async loadFederalPlugin(
    config: Record<string, unknown>,
    pipeline?: IPipelineService,
  ): Promise<IRegionPlugin> {
    if (!pipeline) {
      throw new Error(
        `Cannot load federal plugin: ScrapingPipelineService is not available. ` +
          `Ensure ScrapingPipelineModule is imported and SCRAPING_PIPELINE is provided.`,
      );
    }

    const regionConfig = config as unknown as DeclarativeRegionConfig;

    if (!regionConfig?.regionId || !regionConfig?.dataSources) {
      throw new Error(
        `Federal plugin requires a valid DeclarativeRegionConfig with regionId and dataSources`,
      );
    }

    this.logger.log(
      `Loading federal plugin (${regionConfig.dataSources.length} data sources)`,
    );

    const plugin = new DeclarativeRegionPlugin(regionConfig, pipeline);
    await this.registry.registerFederal("federal", plugin, config);

    this.logger.log(
      `Federal plugin loaded (v${plugin.getVersion()}, ${regionConfig.dataSources.length} data sources)`,
    );
    return plugin;
  }

  /**
   * Unload the active local plugin.
   */
  async unloadPlugin(): Promise<void> {
    await this.registry.unregister();
  }
}
