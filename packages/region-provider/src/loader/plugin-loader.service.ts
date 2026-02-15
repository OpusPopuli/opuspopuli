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
 */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(private readonly registry: PluginRegistryService) {}

  /**
   * Load a declarative plugin and register it.
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
    await this.registry.register(name, plugin, config);

    this.logger.log(
      `Declarative plugin "${name}" loaded (v${plugin.getVersion()}, ${regionConfig.dataSources.length} data sources)`,
    );
    return plugin;
  }

  /**
   * Unload the active plugin.
   */
  async unloadPlugin(): Promise<void> {
    await this.registry.unregister();
  }
}
