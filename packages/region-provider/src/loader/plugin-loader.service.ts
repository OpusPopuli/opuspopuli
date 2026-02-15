import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type { IRegionPlugin } from "@opuspopuli/region-plugin-sdk";
import type { DeclarativeRegionConfig } from "@opuspopuli/common";
import { PluginRegistryService } from "../registry/plugin-registry.service.js";
import {
  DeclarativeRegionPlugin,
  type IPipelineService,
} from "../declarative/declarative-region-plugin.js";

export interface PluginDefinition {
  name: string;
  packageName?: string;
  pluginType?: "code" | "declarative";
  config?: Record<string, unknown>;
}

/**
 * Plugin Loader
 *
 * Dynamically loads region plugins — either code-based (npm packages)
 * or declarative (JSON config + scraping pipeline).
 */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(
    private readonly registry: PluginRegistryService,
    @Optional()
    @Inject("SCRAPING_PIPELINE")
    private readonly pipeline?: IPipelineService,
  ) {}

  /**
   * Load a plugin and register it.
   *
   * For code plugins: imports an npm package with a default or named export.
   * For declarative plugins: wraps a DeclarativeRegionConfig with the pipeline.
   */
  async loadPlugin(definition: PluginDefinition): Promise<IRegionPlugin> {
    const pluginType = definition.pluginType ?? "code";

    if (pluginType === "declarative") {
      return this.loadDeclarativePlugin(definition);
    }

    return this.loadCodePlugin(definition);
  }

  /**
   * Unload the active plugin.
   */
  async unloadPlugin(): Promise<void> {
    await this.registry.unregister();
  }

  /**
   * Load a code-based plugin from an npm package.
   *
   * Convention: the package should have a default export that is the plugin class,
   * or a named export matching PascalCase(name) + "RegionPlugin".
   */
  private async loadCodePlugin(
    definition: PluginDefinition,
  ): Promise<IRegionPlugin> {
    const { name, packageName, config } = definition;

    if (!packageName) {
      throw new Error(`Code plugin "${name}" requires a packageName`);
    }

    this.logger.log(`Loading code plugin "${name}" from ${packageName}`);

    try {
      const pluginModule = await import(packageName);

      // Try default export first, then named export by convention
      const PluginClass =
        pluginModule.default || pluginModule[this.getPluginClassName(name)];

      if (!PluginClass) {
        throw new Error(
          `Plugin package ${packageName} must have a default export or a named export "${this.getPluginClassName(name)}"`,
        );
      }

      const plugin: IRegionPlugin = new PluginClass();
      await this.registry.register(name, plugin, config);

      this.logger.log(
        `Code plugin "${name}" loaded successfully (v${plugin.getVersion()})`,
      );
      return plugin;
    } catch (error) {
      this.logger.error(
        `Failed to load code plugin "${name}" from ${packageName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Load a declarative plugin from JSON config + scraping pipeline.
   */
  private async loadDeclarativePlugin(
    definition: PluginDefinition,
  ): Promise<IRegionPlugin> {
    const { name, config } = definition;

    if (!this.pipeline) {
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

    const plugin = new DeclarativeRegionPlugin(regionConfig, this.pipeline);
    await this.registry.register(name, plugin, config);

    this.logger.log(
      `Declarative plugin "${name}" loaded (v${plugin.getVersion()}, ${regionConfig.dataSources.length} data sources)`,
    );
    return plugin;
  }

  /**
   * Convert plugin name to expected class name.
   * e.g., "california" -> "CaliforniaRegionPlugin"
   */
  private getPluginClassName(name: string): string {
    const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
    return `${capitalized}RegionPlugin`;
  }
}
