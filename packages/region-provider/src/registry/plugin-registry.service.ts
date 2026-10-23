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
 * Manages a federal slot (always loaded) and multiple local slots (one per
 * enabled region). Federal provides FEC campaign finance data scoped to the
 * local region's state. Local plugins provide civic data for each enabled
 * region — state and county plugins can all be active simultaneously.
 */
@Injectable()
export class PluginRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(PluginRegistryService.name);
  private federalPlugin: RegisteredPlugin | undefined;
  private readonly localPlugins: Map<string, RegisteredPlugin> = new Map();

  /**
   * Register a local plugin. If a plugin with the same name is already
   * registered it is destroyed and replaced. Different names are additive —
   * both plugins remain active. Backward-compatible alias for registerLocal().
   */
  async register(
    name: string,
    instance: IRegionPlugin,
    config?: Record<string, unknown>,
  ): Promise<void> {
    return this.registerLocal(name, instance, config);
  }

  /**
   * Register a local region plugin. Adds to the pool of active local plugins.
   * Replaces an existing entry only when the same name is re-registered.
   */
  async registerLocal(
    name: string,
    instance: IRegionPlugin,
    config?: Record<string, unknown>,
  ): Promise<void> {
    if (this.localPlugins.has(name)) {
      await this.unregisterLocalByName(name);
    }

    this.logger.log(`Registering local plugin: ${name}`);

    try {
      await instance.initialize(config);

      this.localPlugins.set(name, {
        name,
        instance,
        status: "active",
        loadedAt: new Date(),
      });

      this.logger.log(`Local plugin registered successfully: ${name}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(
        `Failed to initialize local plugin ${name}: ${errorMessage}`,
      );

      this.localPlugins.set(name, {
        name,
        instance,
        status: "error",
        lastError: errorMessage,
        loadedAt: new Date(),
      });

      throw error;
    }
  }

  /**
   * Replace every local plugin at once (S2, `docs/plans/S2-per-type-sync-jobs.md`).
   *
   * The new plugins are initialised BEFORE anything is removed, then swapped
   * into the map in one synchronous step, and only then are the old ones
   * destroyed. `unregister()` followed by re-registration — what a refresh
   * did before — leaves the map empty across every await in between, and a
   * sync reading the registry in that window syncs no local plugin at all
   * while reporting success. With syncs now running concurrently in one
   * process, that window is reachable; here there is none.
   *
   * A plugin whose `initialize` throws is kept with status `error`, as
   * `registerLocal` keeps it. When none initialises, `fallback` is used
   * instead — inside the same swap, so readers never see zero active.
   */
  async replaceLocal(
    entries: {
      name: string;
      instance: IRegionPlugin;
      config?: Record<string, unknown>;
    }[],
    fallback?: () => { name: string; instance: IRegionPlugin },
  ): Promise<void> {
    const next = new Map<string, RegisteredPlugin>();
    for (const entry of entries) {
      next.set(entry.name, await this.initialised(entry));
    }
    if (fallback && ![...next.values()].some((p) => p.status === "active")) {
      const { name, instance } = fallback();
      this.logger.warn(`No local plugin initialised; falling back to ${name}`);
      next.set(name, await this.initialised({ name, instance }));
    }

    // The swap: no await between clear and refill.
    const previous = [...this.localPlugins.values()];
    this.localPlugins.clear();
    for (const [name, plugin] of next) this.localPlugins.set(name, plugin);

    for (const old of previous) {
      if (next.get(old.name)?.instance === old.instance) continue;
      try {
        await old.instance.destroy();
      } catch (error) {
        this.logger.error(`Error destroying local plugin ${old.name}:`, error);
      }
    }
    this.logger.log(
      `Local plugins replaced: ${[...next.keys()].join(", ") || "(none)"}`,
    );
  }

  private async initialised(entry: {
    name: string;
    instance: IRegionPlugin;
    config?: Record<string, unknown>;
  }): Promise<RegisteredPlugin> {
    try {
      await entry.instance.initialize(entry.config);
      return {
        name: entry.name,
        instance: entry.instance,
        status: "active",
        loadedAt: new Date(),
      };
    } catch (error) {
      const lastError = (error as Error).message;
      this.logger.error(
        `Failed to initialize local plugin ${entry.name}: ${lastError}`,
      );
      return {
        name: entry.name,
        instance: entry.instance,
        status: "error",
        lastError,
        loadedAt: new Date(),
      };
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
   * Unregister and cleanup all local plugins.
   * Backward-compatible: unregister() only affects the local slot(s).
   */
  async unregister(): Promise<void> {
    await this.unregisterSlot("local");
  }

  /**
   * Get a local plugin instance by name, or the first active one if no name
   * is given. Returns undefined when no active local plugin exists.
   */
  getLocal(name?: string): IRegionPlugin | undefined {
    if (name) {
      const entry = this.localPlugins.get(name);
      return entry?.status === "active" ? entry.instance : undefined;
    }
    for (const entry of this.localPlugins.values()) {
      if (entry.status === "active") return entry.instance;
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
   * Get all registered plugins (federal + all active locals).
   * Returns only active plugins, locals in registration order.
   */
  getAll(): RegisteredPlugin[] {
    const plugins: RegisteredPlugin[] = [];
    if (this.federalPlugin?.status === "active") {
      plugins.push(this.federalPlugin);
    }
    for (const entry of this.localPlugins.values()) {
      if (entry.status === "active") plugins.push(entry);
    }
    return plugins;
  }

  /**
   * Get the name of the first active local plugin, or undefined if none loaded.
   */
  getActiveName(): string | undefined {
    for (const entry of this.localPlugins.values()) {
      if (entry.status === "active") return entry.name;
    }
    return undefined;
  }

  /**
   * Check if at least one local plugin is registered and active.
   */
  hasActive(): boolean {
    for (const entry of this.localPlugins.values()) {
      if (entry.status === "active") return true;
    }
    return false;
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
   * pluginName / pluginStatus reflect the first registered local plugin;
   * use getAll() to inspect every loaded plugin.
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
    const first = [...this.localPlugins.values()][0];
    return {
      hasPlugin: this.localPlugins.size > 0,
      pluginName: first?.name,
      pluginStatus: first?.status,
      lastError: first?.lastError,
      loadedAt: first?.loadedAt,
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
   * Unregister and cleanup a specific slot. For "local" this destroys all
   * registered local plugins and clears the map.
   */
  private async unregisterSlot(slot: "federal" | "local"): Promise<void> {
    if (slot === "federal") {
      if (!this.federalPlugin) return;
      this.logger.log(
        `Unregistering federal plugin: ${this.federalPlugin.name}`,
      );
      try {
        await this.federalPlugin.instance.destroy();
      } catch (error) {
        this.logger.error(`Error destroying federal plugin:`, error);
      }
      this.federalPlugin = undefined;
      return;
    }

    for (const entry of this.localPlugins.values()) {
      this.logger.log(`Unregistering local plugin: ${entry.name}`);
      try {
        await entry.instance.destroy();
      } catch (error) {
        this.logger.error(
          `Error destroying local plugin ${entry.name}:`,
          error,
        );
      }
    }
    this.localPlugins.clear();
  }

  /**
   * Destroy and remove a single local plugin by name.
   */
  private async unregisterLocalByName(name: string): Promise<void> {
    const entry = this.localPlugins.get(name);
    if (!entry) return;
    this.logger.log(`Unregistering local plugin: ${name}`);
    try {
      await entry.instance.destroy();
    } catch (error) {
      this.logger.error(`Error destroying local plugin ${name}:`, error);
    }
    this.localPlugins.delete(name);
  }
}
