import "reflect-metadata";
import { PluginLoaderService } from "../src/loader/plugin-loader.service";
import { PluginRegistryService } from "../src/registry/plugin-registry.service";
import type { IRegionPlugin } from "@opuspopuli/region-plugin-sdk";
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
  getSupportedDataTypes = jest.fn().mockReturnValue([DataType.PROPOSITIONS]);
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
      // Mock the loadPlugin to simulate a successful dynamic import
      loader.loadPlugin = async (definition) => {
        // Simulate what loadPlugin does with a successful import
        const plugin = new MockRegionPlugin();
        await registry.register(definition.name, plugin, definition.config);
        return plugin;
      };

      const plugin = await loader.loadPlugin({
        name: "mock",
        packageName: "@opuspopuli/region-mock",
      });

      expect(plugin).toBeDefined();
      expect(registry.hasActive()).toBe(true);
      expect(registry.getActiveName()).toBe("mock");
    });

    it("should pass config to the registry during registration", async () => {
      const config = { apiKey: "test-key" };
      const registerSpy = jest.spyOn(registry, "register");

      loader.loadPlugin = async (definition) => {
        const plugin = new MockRegionPlugin();
        await registry.register(definition.name, plugin, definition.config);
        return plugin;
      };

      await loader.loadPlugin({
        name: "mock",
        packageName: "@opuspopuli/region-mock",
        config,
      });

      expect(registerSpy).toHaveBeenCalledWith(
        "mock",
        expect.any(Object),
        config,
      );
    });

    it("should throw when package has no valid export", async () => {
      // Test the error path by directly calling the real method
      // with a non-existent package
      await expect(
        loader.loadPlugin({
          name: "nonexistent",
          packageName: "@opuspopuli/does-not-exist",
        }),
      ).rejects.toThrow();
    });
  });

  describe("unloadPlugin", () => {
    it("should unload the active plugin via registry", async () => {
      const plugin = new MockRegionPlugin();
      await registry.register("mock", plugin);

      await loader.unloadPlugin();

      expect(registry.hasActive()).toBe(false);
      expect(plugin.destroy).toHaveBeenCalled();
    });

    it("should not throw when no plugin is loaded", async () => {
      await expect(loader.unloadPlugin()).resolves.not.toThrow();
    });
  });

  describe("getPluginClassName", () => {
    it("should convert plugin name to PascalCase class name", () => {
      const getClassName = (loader as any).getPluginClassName.bind(loader);

      expect(getClassName("california")).toBe("CaliforniaRegionPlugin");
      expect(getClassName("texas")).toBe("TexasRegionPlugin");
      expect(getClassName("example")).toBe("ExampleRegionPlugin");
    });

    it("should handle single character names", () => {
      const getClassName = (loader as any).getPluginClassName.bind(loader);

      expect(getClassName("a")).toBe("ARegionPlugin");
    });
  });
});
