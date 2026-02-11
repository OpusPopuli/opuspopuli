import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type {
  IRegionPlugin,
  PluginHealth,
} from "@opuspopuli/region-plugin-sdk";

export interface RegisteredPlugin {
  name: string;
  instance: IRegionPlugin;
  status: "active" | "error";
  lastError?: string;
  loadedAt: Date;
}

/**
 * Plugin Registry
 *
 * Manages the active region plugin and its lifecycle.
 * Single-region: holds at most one plugin at a time.
 */
@Injectable()
export class PluginRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(PluginRegistryService.name);
  private plugin: RegisteredPlugin | undefined;

  /**
   * Register a plugin instance. Replaces any previously registered plugin.
   */
  async register(
    name: string,
    instance: IRegionPlugin,
    config?: Record<string, unknown>,
  ): Promise<void> {
    // Unregister existing plugin if any
    if (this.plugin) {
      await this.unregister();
    }

    this.logger.log(`Registering plugin: ${name}`);

    try {
      await instance.initialize(config);

      this.plugin = {
        name,
        instance,
        status: "active",
        loadedAt: new Date(),
      };

      this.logger.log(`Plugin registered successfully: ${name}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(`Failed to initialize plugin ${name}: ${errorMessage}`);

      this.plugin = {
        name,
        instance,
        status: "error",
        lastError: errorMessage,
        loadedAt: new Date(),
      };

      throw error;
    }
  }

  /**
   * Unregister and cleanup the active plugin.
   */
  async unregister(): Promise<void> {
    if (!this.plugin) return;

    const { name } = this.plugin;
    this.logger.log(`Unregistering plugin: ${name}`);

    try {
      await this.plugin.instance.destroy();
    } catch (error) {
      this.logger.error(`Error destroying plugin ${name}:`, error);
    }

    this.plugin = undefined;
  }

  /**
   * Get the active plugin instance, or undefined if none loaded.
   */
  getActive(): IRegionPlugin | undefined {
    if (this.plugin?.status === "active") {
      return this.plugin.instance;
    }
    return undefined;
  }

  /**
   * Get the active plugin name, or undefined if none loaded.
   */
  getActiveName(): string | undefined {
    return this.plugin?.name;
  }

  /**
   * Check if a plugin is registered and active.
   */
  hasActive(): boolean {
    return this.plugin?.status === "active";
  }

  /**
   * Get health status of the active plugin.
   */
  async getHealth(): Promise<PluginHealth | undefined> {
    const active = this.getActive();
    if (!active) return undefined;

    try {
      return await active.healthCheck();
    } catch (error) {
      this.logger.error("Health check failed:", error);
      return {
        healthy: false,
        message: (error as Error).message,
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Get registry status for diagnostics.
   */
  getStatus(): {
    hasPlugin: boolean;
    pluginName?: string;
    pluginStatus?: string;
    lastError?: string;
    loadedAt?: Date;
  } {
    if (!this.plugin) {
      return { hasPlugin: false };
    }
    return {
      hasPlugin: true,
      pluginName: this.plugin.name,
      pluginStatus: this.plugin.status,
      lastError: this.plugin.lastError,
      loadedAt: this.plugin.loadedAt,
    };
  }

  /**
   * Cleanup on module destroy.
   */
  async onModuleDestroy(): Promise<void> {
    await this.unregister();
  }
}
