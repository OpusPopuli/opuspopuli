import "reflect-metadata";
import { PluginRegistryService } from "../src/registry/plugin-registry.service";
import type {
  IRegionPlugin,
  PluginHealth,
} from "../src/interfaces/plugin.interface";
import { DataType } from "@opuspopuli/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

function createMockPlugin(
  overrides?: Partial<Record<keyof IRegionPlugin, jest.Mock>>,
): IRegionPlugin & Record<string, jest.Mock> {
  const mock = {
    getName: jest.fn().mockReturnValue("test-plugin"),
    getVersion: jest.fn().mockReturnValue("1.0.0"),
    getRegionInfo: jest.fn().mockReturnValue({
      id: "test",
      name: "Test Region",
      description: "Test",
      timezone: "UTC",
    }),
    getSupportedDataTypes: jest.fn().mockReturnValue([DataType.PROPOSITIONS]),
    fetchPropositions: jest.fn().mockResolvedValue([]),
    fetchMeetings: jest.fn().mockResolvedValue([]),
    fetchRepresentatives: jest.fn().mockResolvedValue([]),
    initialize: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue({
      healthy: true,
      message: "OK",
      lastCheck: new Date(),
    } satisfies PluginHealth),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return mock as unknown as IRegionPlugin & Record<string, jest.Mock>;
}

describe("PluginRegistryService", () => {
  let registry: PluginRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PluginRegistryService();
  });

  describe("register", () => {
    it("should register a plugin and initialize it", async () => {
      const plugin = createMockPlugin();

      await registry.register("test", plugin);

      expect(plugin.initialize).toHaveBeenCalled();
      expect(registry.hasActive()).toBe(true);
      expect(registry.getActive()).toBe(plugin);
    });

    it("should register with config", async () => {
      const plugin = createMockPlugin();
      const config = { apiKey: "test" };

      await registry.register("test", plugin, config);

      expect(plugin.initialize).toHaveBeenCalledWith(config);
    });

    it("should unregister existing plugin before registering new one", async () => {
      const plugin1 = createMockPlugin();
      const plugin2 = createMockPlugin();

      await registry.register("plugin1", plugin1);
      await registry.register("plugin2", plugin2);

      expect(plugin1.destroy).toHaveBeenCalled();
      expect(registry.getActive()).toBe(plugin2);
      expect(registry.getActiveName()).toBe("plugin2");
    });

    it("should mark plugin as error if initialize fails", async () => {
      const plugin = createMockPlugin({
        initialize: jest.fn().mockRejectedValue(new Error("Init failed")),
      });

      await expect(registry.register("test", plugin)).rejects.toThrow(
        "Init failed",
      );

      expect(registry.hasActive()).toBe(false);
      expect(registry.getActive()).toBeUndefined();

      const status = registry.getStatus();
      expect(status.pluginStatus).toBe("error");
      expect(status.lastError).toBe("Init failed");
    });
  });

  describe("unregister", () => {
    it("should destroy and remove the plugin", async () => {
      const plugin = createMockPlugin();
      await registry.register("test", plugin);

      await registry.unregister();

      expect(plugin.destroy).toHaveBeenCalled();
      expect(registry.hasActive()).toBe(false);
      expect(registry.getActive()).toBeUndefined();
    });

    it("should be safe to call when no plugin is registered", async () => {
      await expect(registry.unregister()).resolves.not.toThrow();
    });

    it("should handle destroy errors gracefully", async () => {
      const plugin = createMockPlugin({
        destroy: jest.fn().mockRejectedValue(new Error("Destroy failed")),
      });
      await registry.register("test", plugin);

      await expect(registry.unregister()).resolves.not.toThrow();
      expect(registry.hasActive()).toBe(false);
    });
  });

  describe("getHealth", () => {
    it("should return health from the active plugin", async () => {
      const plugin = createMockPlugin();
      await registry.register("test", plugin);

      const health = await registry.getHealth();

      expect(health).toBeDefined();
      expect(health!.healthy).toBe(true);
      expect(plugin.healthCheck).toHaveBeenCalled();
    });

    it("should return undefined when no plugin is active", async () => {
      const health = await registry.getHealth();
      expect(health).toBeUndefined();
    });

    it("should return unhealthy if healthCheck throws", async () => {
      const plugin = createMockPlugin({
        healthCheck: jest
          .fn()
          .mockRejectedValue(new Error("Health check failed")),
      });
      await registry.register("test", plugin);

      const health = await registry.getHealth();

      expect(health).toBeDefined();
      expect(health!.healthy).toBe(false);
      expect(health!.message).toBe("Health check failed");
    });
  });

  describe("getStatus", () => {
    it("should return hasPlugin: false when empty", () => {
      const status = registry.getStatus();
      expect(status.hasPlugin).toBe(false);
    });

    it("should return plugin info when active", async () => {
      const plugin = createMockPlugin();
      await registry.register("test", plugin);

      const status = registry.getStatus();
      expect(status.hasPlugin).toBe(true);
      expect(status.pluginName).toBe("test");
      expect(status.pluginStatus).toBe("active");
      expect(status.loadedAt).toBeInstanceOf(Date);
    });
  });

  describe("onModuleDestroy", () => {
    it("should unregister plugin on module destroy", async () => {
      const plugin = createMockPlugin();
      await registry.register("test", plugin);

      await registry.onModuleDestroy();

      expect(plugin.destroy).toHaveBeenCalled();
      expect(registry.hasActive()).toBe(false);
    });
  });
});
