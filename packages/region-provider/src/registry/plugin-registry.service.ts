import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type {
  IRegionPlugin,
  PluginHealth,
} from "../interfaces/plugin.interface.js";

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
 * Manages two plugin slots: federal (always loaded) and local (user-selectable).
 * Federal provides FEC campaign finance data scoped to the local region's state.
 * Local provides civic data (propositions, meetings, representatives) + state-level campaign finance.
 */
@Injectable()
export class PluginRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(PluginRegistryService.name);
  private federalPlugin: RegisteredPlugin | undefined;
  private localPlugin: RegisteredPlugin | undefined;

  /**
   * Register a local plugin. Replaces any previously registered local plugin.
   * Backward-compatible alias for registerLocal().
   */
  async register(
    name: string,
    instance: IRegionPlugin,
    config?: Record<string, unknown>,
  ): Promise<void> {
    return this.registerLocal(name, instance, config);
  }

  /**
   * Register the local region plugin (e.g., California).
   * Replaces any previously registered local plugin.
   */
  async registerLocal(
    name: string,
    instance: IRegionPlugin,
    config?: Record<string, unknown>,
  ): Promise<void> {
    if (this.localPlugin) {
      await this.unregisterSlot("local");
    }

    this.logger.log(`Registering local plugin: ${name}`);

    try {
      await instance.initialize(config);

      this.localPlugin = {
        name,
        instance,
        status: "active",
        loadedAt: new Date(),
      };

      this.logger.log(`Local plugin registered successfully: ${name}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(
        `Failed to initialize local plugin ${name}: ${errorMessage}`,
      );

      this.localPlugin = {
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
   * Register the federal plugin (loaded unconditionally at startup).
   */
  async registerFederal(
    name: string,
    instance: IRegionPlugin,
    config?: Record<string, unknown>,
  ): Promise<void> {
    if (this.federalPlugin) {
      await this.unregisterSlot("federal");
    }

    this.logger.log(`Registering federal plugin: ${name}`);

    try {
      await instance.initialize(config);

      this.federalPlugin = {
        name,
        instance,
        status: "active",
        loadedAt: new Date(),
      };

      this.logger.log(`Federal plugin registered successfully: ${name}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(
        `Failed to initialize federal plugin ${name}: ${errorMessage}`,
      );

      this.federalPlugin = {
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
   * Unregister and cleanup the local plugin.
   * Backward-compatible: unregister() only affects the local slot.
   */
  async unregister(): Promise<void> {
    await this.unregisterSlot("local");
  }

  /**
   * Get the local plugin instance, or undefined if none loaded.
   */
  getLocal(): IRegionPlugin | undefined {
    if (this.localPlugin?.status === "active") {
      return this.localPlugin.instance;
    }
    return undefined;
  }

  /**
   * Get the federal plugin instance, or undefined if none loaded.
   */
  getFederal(): IRegionPlugin | undefined {
    if (this.federalPlugin?.status === "active") {
      return this.federalPlugin.instance;
    }
    return undefined;
  }

  /**
   * Get the active local plugin instance.
   * Backward-compatible alias for getLocal().
   */
  getActive(): IRegionPlugin | undefined {
    return this.getLocal();
  }

  /**
   * Get all registered plugins (federal + local).
   * Returns only active plugins.
   */
  getAll(): RegisteredPlugin[] {
    const plugins: RegisteredPlugin[] = [];
    if (this.federalPlugin?.status === "active") {
      plugins.push(this.federalPlugin);
    }
    if (this.localPlugin?.status === "active") {
      plugins.push(this.localPlugin);
    }
    return plugins;
  }

  /**
   * Get the active local plugin name, or undefined if none loaded.
   */
  getActiveName(): string | undefined {
    return this.localPlugin?.name;
  }

  /**
   * Check if a local plugin is registered and active.
   */
  hasActive(): boolean {
    return this.localPlugin?.status === "active";
  }

  /**
   * Get health status of the local plugin.
   */
  async getHealth(): Promise<PluginHealth | undefined> {
    const active = this.getLocal();
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
    federalLoaded: boolean;
    federalName?: string;
  } {
    return {
      hasPlugin: this.localPlugin !== undefined,
      pluginName: this.localPlugin?.name,
      pluginStatus: this.localPlugin?.status,
      lastError: this.localPlugin?.lastError,
      loadedAt: this.localPlugin?.loadedAt,
      federalLoaded: this.federalPlugin?.status === "active",
      federalName: this.federalPlugin?.name,
    };
  }

  /**
   * Cleanup on module destroy.
   */
  async onModuleDestroy(): Promise<void> {
    await this.unregisterSlot("federal");
    await this.unregisterSlot("local");
  }

  /**
   * Unregister and cleanup a specific plugin slot.
   */
  private async unregisterSlot(slot: "federal" | "local"): Promise<void> {
    const plugin = slot === "federal" ? this.federalPlugin : this.localPlugin;
    if (!plugin) return;

    this.logger.log(`Unregistering ${slot} plugin: ${plugin.name}`);

    try {
      await plugin.instance.destroy();
    } catch (error) {
      this.logger.error(
        `Error destroying ${slot} plugin ${plugin.name}:`,
        error,
      );
    }

    if (slot === "federal") {
      this.federalPlugin = undefined;
    } else {
      this.localPlugin = undefined;
    }
  }
}
