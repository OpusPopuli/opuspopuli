import { Injectable, Logger } from "@nestjs/common";
import type { IRegionPlugin } from "@opuspopuli/region-plugin-sdk";
import { PluginRegistryService } from "../registry/plugin-registry.service.js";

export interface PluginDefinition {
  name: string;
  packageName: string;
  config?: Record<string, unknown>;
}

/**
 * Plugin Loader
 *
 * Dynamically loads region plugins from npm packages
 * and registers them in the plugin registry.
 */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);

  constructor(private readonly registry: PluginRegistryService) {}

  /**
   * Load a plugin from an npm package and register it.
   *
   * Convention: the package should have a default export that is the plugin class,
   * or a named export matching PascalCase(name) + "RegionPlugin".
   */
  async loadPlugin(definition: PluginDefinition): Promise<IRegionPlugin> {
    const { name, packageName, config } = definition;
    this.logger.log(`Loading plugin "${name}" from ${packageName}`);

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
        `Plugin "${name}" loaded successfully (v${plugin.getVersion()})`,
      );
      return plugin;
    } catch (error) {
      this.logger.error(
        `Failed to load plugin "${name}" from ${packageName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Unload the active plugin.
   */
  async unloadPlugin(): Promise<void> {
    await this.registry.unregister();
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
