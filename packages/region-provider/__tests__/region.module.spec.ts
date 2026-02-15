import "reflect-metadata";
import { RegionModule } from "../src/region.module";
import { RegionService } from "../src/region.service";
import { ExampleRegionProvider } from "../src/providers/example.provider";
import { PluginRegistryService } from "../src/registry/plugin-registry.service";
import { PluginLoaderService } from "../src/loader/plugin-loader.service";

// Mock NestJS dependencies
jest.mock("@nestjs/common", () => ({
  Module: () => (target: any) => target,
  Injectable: () => (target: any) => target,
  Optional: () => () => {},
  Inject: () => () => {},
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

jest.mock("@nestjs/config", () => ({
  ConfigService: jest.fn(),
}));

describe("RegionModule", () => {
  describe("forPlugins", () => {
    it("should return a dynamic module with plugin services", () => {
      const result = RegionModule.forPlugins();

      expect(result.module).toBe(RegionModule);
      expect(result.providers).toContain(PluginRegistryService);
      expect(result.providers).toContain(PluginLoaderService);
      expect(result.exports).toContain(PluginRegistryService);
      expect(result.exports).toContain(PluginLoaderService);
    });
  });

  describe("forRoot", () => {
    it("should return a dynamic module with example provider", () => {
      const result = RegionModule.forRoot();

      expect(result.module).toBe(RegionModule);
      expect(result.providers).toHaveLength(2);
      expect(result.exports).toContain(RegionService);
      expect(result.exports).toContain("REGION_PROVIDER");
    });

    it("should configure REGION_PROVIDER with ExampleRegionProvider", () => {
      const result = RegionModule.forRoot();

      const providerDef = (result.providers as any[]).find(
        (p: any) => p.provide === "REGION_PROVIDER",
      );
      expect(providerDef).toBeDefined();
      expect(providerDef.useClass).toBe(ExampleRegionProvider);
    });

    it("should configure RegionService factory with provider injection", () => {
      const result = RegionModule.forRoot();

      const serviceDef = (result.providers as any[]).find(
        (p: any) => p.provide === RegionService,
      );
      expect(serviceDef).toBeDefined();
      expect(serviceDef.useFactory).toBeDefined();
      expect(serviceDef.inject).toContain("REGION_PROVIDER");

      // Verify factory creates a RegionService
      const mockProvider = new ExampleRegionProvider();
      const service = serviceDef.useFactory(mockProvider);
      expect(service).toBeInstanceOf(RegionService);
    });
  });

  describe("forRootAsync", () => {
    it("should return a dynamic module with async provider", () => {
      const result = RegionModule.forRootAsync();

      expect(result.module).toBe(RegionModule);
      expect(result.providers).toHaveLength(2);
      expect(result.exports).toContain(RegionService);
      expect(result.exports).toContain("REGION_PROVIDER");
    });

    it("should configure async REGION_PROVIDER factory", () => {
      const result = RegionModule.forRootAsync();

      const providerDef = (result.providers as any[]).find(
        (p: any) => p.provide === "REGION_PROVIDER",
      );
      expect(providerDef).toBeDefined();
      expect(providerDef.useFactory).toBeDefined();
      expect(providerDef.inject).toBeDefined();
    });

    it("should resolve to ExampleRegionProvider for default config", async () => {
      const result = RegionModule.forRootAsync();

      const providerDef = (result.providers as any[]).find(
        (p: any) => p.provide === "REGION_PROVIDER",
      );

      const mockConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const provider = await providerDef.useFactory(mockConfigService);
      expect(provider).toBeInstanceOf(ExampleRegionProvider);
    });

    it("should resolve to ExampleRegionProvider for 'example' config", async () => {
      const result = RegionModule.forRootAsync();

      const providerDef = (result.providers as any[]).find(
        (p: any) => p.provide === "REGION_PROVIDER",
      );

      const mockConfigService = {
        get: jest.fn().mockReturnValue("example"),
      };

      const provider = await providerDef.useFactory(mockConfigService);
      expect(provider).toBeInstanceOf(ExampleRegionProvider);
    });

    it("should resolve to ExampleRegionProvider for unknown region (default case)", async () => {
      const result = RegionModule.forRootAsync();

      const providerDef = (result.providers as any[]).find(
        (p: any) => p.provide === "REGION_PROVIDER",
      );

      const mockConfigService = {
        get: jest.fn().mockReturnValue("unknown-region"),
      };

      const provider = await providerDef.useFactory(mockConfigService);
      expect(provider).toBeInstanceOf(ExampleRegionProvider);
    });
  });
});
