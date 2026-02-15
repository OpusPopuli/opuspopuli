import "reflect-metadata";
import { PluginLoaderService } from "../src/loader/plugin-loader.service";
import { PluginRegistryService } from "../src/registry/plugin-registry.service";
import type { IRegionPlugin } from "../src/interfaces/plugin.interface";
import { DataType } from "@opuspopuli/common";
import type { IPipelineService } from "../src/declarative/declarative-region-plugin";

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
  let pipeline: jest.Mocked<IPipelineService>;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PluginRegistryService();
    loader = new PluginLoaderService(registry);
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
  });

  describe("loadPlugin", () => {
    it("should create a DeclarativeRegionPlugin with valid config", async () => {
      const plugin = await loader.loadPlugin(
        {
          name: "california",
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
        },
        pipeline,
      );

      expect(plugin).toBeDefined();
      expect(plugin.getName()).toBe("california");
      expect(plugin.getVersion()).toBe("1.0.0-declarative");
      expect(registry.hasActive()).toBe(true);
      expect(registry.getActiveName()).toBe("california");
    });

    it("should throw when pipeline is not available", async () => {
      await expect(
        loader.loadPlugin({
          name: "california",
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

    it("should throw when config is missing regionId", async () => {
      await expect(
        loader.loadPlugin(
          {
            name: "bad-config",
            config: {
              regionName: "Bad Config",
            } as any,
          },
          pipeline,
        ),
      ).rejects.toThrow(
        "requires a valid DeclarativeRegionConfig with regionId and dataSources",
      );
    });

    it("should throw when config is missing dataSources", async () => {
      await expect(
        loader.loadPlugin(
          {
            name: "bad-config",
            config: {
              regionId: "test",
            } as any,
          },
          pipeline,
        ),
      ).rejects.toThrow(
        "requires a valid DeclarativeRegionConfig with regionId and dataSources",
      );
    });

    it("should throw when config is undefined", async () => {
      await expect(
        loader.loadPlugin(
          {
            name: "bad-config",
          },
          pipeline,
        ),
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
});
