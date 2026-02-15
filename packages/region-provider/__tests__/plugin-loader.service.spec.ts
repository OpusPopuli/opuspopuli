import "reflect-metadata";
import { PluginLoaderService } from "../src/loader/plugin-loader.service";
import { PluginRegistryService } from "../src/registry/plugin-registry.service";
import type { IRegionPlugin } from "@opuspopuli/region-plugin-sdk";
import { DataType } from "@opuspopuli/common";
import type { IPipelineService } from "../src/declarative/declarative-region-plugin";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Optional: () => () => {},
  Inject: () => () => {},
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

  describe("loadPlugin — code plugins", () => {
    it("should load a code plugin from a package with default export", async () => {
      // Mock the loadPlugin to simulate a successful dynamic import
      const origLoadPlugin = loader.loadPlugin.bind(loader);
      loader.loadPlugin = async (definition) => {
        if (definition.pluginType === "declarative") {
          return origLoadPlugin(definition);
        }
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

    it("should default to code pluginType when not specified", async () => {
      await expect(
        loader.loadPlugin({
          name: "nonexistent",
          packageName: "@opuspopuli/does-not-exist",
        }),
      ).rejects.toThrow();
    });

    it("should throw when code plugin has no packageName", async () => {
      await expect(
        loader.loadPlugin({
          name: "test",
          pluginType: "code",
        }),
      ).rejects.toThrow('Code plugin "test" requires a packageName');
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
      await expect(
        loader.loadPlugin({
          name: "nonexistent",
          packageName: "@opuspopuli/does-not-exist",
        }),
      ).rejects.toThrow();
    });
  });

  describe("loadPlugin — declarative plugins", () => {
    let pipeline: jest.Mocked<IPipelineService>;

    beforeEach(() => {
      pipeline = {
        execute: jest.fn().mockResolvedValue({
          items: [],
          manifestVersion: 1,
          success: true,
          warnings: [],
          errors: [],
          extractionTimeMs: 0,
        }),
      };
      loader = new PluginLoaderService(registry, pipeline);
    });

    it("should create a DeclarativeRegionPlugin when pluginType is declarative", async () => {
      const plugin = await loader.loadPlugin({
        name: "california",
        pluginType: "declarative",
        config: {
          regionId: "california",
          regionName: "California",
          description: "CA civic data",
          timezone: "America/Los_Angeles",
          dataSources: [
            {
              url: "https://example.com/props",
              dataType: "propositions",
              contentGoal: "Extract propositions",
            },
          ],
        },
      });

      expect(plugin).toBeDefined();
      expect(plugin.getName()).toBe("california");
      expect(plugin.getVersion()).toBe("1.0.0-declarative");
      expect(registry.hasActive()).toBe(true);
      expect(registry.getActiveName()).toBe("california");
    });

    it("should throw when pipeline is not available for declarative plugin", async () => {
      const loaderWithoutPipeline = new PluginLoaderService(registry);

      await expect(
        loaderWithoutPipeline.loadPlugin({
          name: "california",
          pluginType: "declarative",
          config: {
            regionId: "california",
            regionName: "California",
            description: "CA",
            timezone: "America/Los_Angeles",
            dataSources: [],
          },
        }),
      ).rejects.toThrow("ScrapingPipelineService is not available");
    });

    it("should throw when declarative config is missing regionId", async () => {
      await expect(
        loader.loadPlugin({
          name: "bad-config",
          pluginType: "declarative",
          config: {
            regionName: "Bad Config",
          } as any,
        }),
      ).rejects.toThrow(
        "requires a valid DeclarativeRegionConfig with regionId and dataSources",
      );
    });

    it("should throw when declarative config is missing dataSources", async () => {
      await expect(
        loader.loadPlugin({
          name: "bad-config",
          pluginType: "declarative",
          config: {
            regionId: "test",
          } as any,
        }),
      ).rejects.toThrow(
        "requires a valid DeclarativeRegionConfig with regionId and dataSources",
      );
    });

    it("should throw when config is undefined for declarative plugin", async () => {
      await expect(
        loader.loadPlugin({
          name: "bad-config",
          pluginType: "declarative",
        }),
      ).rejects.toThrow(
        "requires a valid DeclarativeRegionConfig with regionId and dataSources",
      );
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
