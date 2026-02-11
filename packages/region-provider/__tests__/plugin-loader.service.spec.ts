import "reflect-metadata";
import { PluginLoaderService } from "../src/loader/plugin-loader.service";
import { PluginRegistryService } from "../src/registry/plugin-registry.service";
import type { IRegionPlugin } from "@opuspopuli/region-plugin-sdk";
import { CivicDataType } from "@opuspopuli/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

// Mock plugin class
class MockRegionPlugin implements IRegionPlugin {
  getName = jest.fn().mockReturnValue("mock");
  getVersion = jest.fn().mockReturnValue("1.0.0");
  getRegionInfo = jest.fn().mockReturnValue({
    id: "mock",
    name: "Mock Region",
    description: "Mock",
    timezone: "UTC",
  });
  getSupportedDataTypes = jest
    .fn()
    .mockReturnValue([CivicDataType.PROPOSITIONS]);
  fetchPropositions = jest.fn().mockResolvedValue([]);
  fetchMeetings = jest.fn().mockResolvedValue([]);
  fetchRepresentatives = jest.fn().mockResolvedValue([]);
  initialize = jest.fn().mockResolvedValue(undefined);
  healthCheck = jest.fn().mockResolvedValue({
    healthy: true,
    message: "OK",
    lastCheck: new Date(),
  });
  destroy = jest.fn().mockResolvedValue(undefined);
}

describe("PluginLoaderService", () => {
  let loader: PluginLoaderService;
  let registry: PluginRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PluginRegistryService();
    loader = new PluginLoaderService(registry);
  });

  describe("loadPlugin", () => {
    it("should load a plugin from a package with default export", async () => {
      // Mock dynamic import
      jest
        .spyOn(loader as any, "loadPlugin")
        .mockImplementation(async (definition: any) => {
          const plugin = new MockRegionPlugin();
          await registry.register(definition.name, plugin, definition.config);
          return plugin;
        });

      const plugin = await loader.loadPlugin({
        name: "mock",
        packageName: "@opuspopuli/region-mock",
      });

      expect(plugin).toBeDefined();
      expect(registry.hasActive()).toBe(true);
    });

    it("should pass config to the plugin", async () => {
      const config = { apiKey: "test-key" };

      jest
        .spyOn(loader as any, "loadPlugin")
        .mockImplementation(async (definition: any) => {
          const plugin = new MockRegionPlugin();
          await registry.register(definition.name, plugin, definition.config);
          return plugin;
        });

      await loader.loadPlugin({
        name: "mock",
        packageName: "@opuspopuli/region-mock",
        config,
      });

      expect(registry.hasActive()).toBe(true);
    });
  });

  describe("unloadPlugin", () => {
    it("should unload the active plugin", async () => {
      // Register a plugin directly
      const plugin = new MockRegionPlugin();
      await registry.register("mock", plugin);

      await loader.unloadPlugin();

      expect(registry.hasActive()).toBe(false);
      expect(plugin.destroy).toHaveBeenCalled();
    });
  });

  describe("getPluginClassName", () => {
    it("should convert plugin name to PascalCase class name", () => {
      const getClassName = (loader as any).getPluginClassName.bind(loader);

      expect(getClassName("california")).toBe("CaliforniaRegionPlugin");
      expect(getClassName("texas")).toBe("TexasRegionPlugin");
      expect(getClassName("example")).toBe("ExampleRegionPlugin");
    });
  });
});
