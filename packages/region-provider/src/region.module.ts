import { Module, DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IRegionProvider } from "@opuspopuli/common";
import { RegionService } from "./region.service.js";
import { ExampleRegionProvider } from "./providers/example.provider.js";
import { PluginRegistryService } from "./registry/plugin-registry.service.js";
import { PluginLoaderService } from "./loader/plugin-loader.service.js";

/**
 * Region Module
 *
 * Configures Dependency Injection for region providers.
 *
 * Three modes of operation:
 *
 * 1. forPlugins() [recommended] - DB-driven plugin loading
 *    The domain service loads the enabled plugin from the database at startup.
 *    Plugins are npm packages that implement IRegionPlugin.
 *
 * 2. forRootAsync() [legacy] - ENV-driven provider selection
 *    Uses REGION_PROVIDER environment variable with a switch statement.
 *
 * 3. forRoot() [legacy] - Default example provider
 *    Uses the built-in ExampleRegionProvider directly.
 */
@Module({})
export class RegionModule {
  /**
   * Plugin-based registration (recommended).
   *
   * Provides the PluginRegistryService and PluginLoaderService.
   * The domain service is responsible for reading the DB config
   * and calling pluginLoader.loadPlugin() during onModuleInit.
   */
  static forPlugins(): DynamicModule {
    return {
      module: RegionModule,
      providers: [PluginRegistryService, PluginLoaderService],
      exports: [PluginRegistryService, PluginLoaderService],
    };
  }

  /**
   * Static registration with default example provider
   */
  static forRoot(): DynamicModule {
    return {
      module: RegionModule,
      providers: [
        {
          provide: "REGION_PROVIDER",
          useClass: ExampleRegionProvider,
        },
        {
          provide: RegionService,
          useFactory: (provider: IRegionProvider) => {
            return new RegionService(provider);
          },
          inject: ["REGION_PROVIDER"],
        },
      ],
      exports: [RegionService, "REGION_PROVIDER"],
    };
  }

  /**
   * Async registration with config-based provider selection
   */
  static forRootAsync(): DynamicModule {
    return {
      module: RegionModule,
      providers: [
        {
          provide: "REGION_PROVIDER",
          useFactory: async (
            configService: ConfigService,
          ): Promise<IRegionProvider> => {
            const providerName =
              configService.get<string>("region.provider") || "example";

            return RegionModule.getProviderForRegion(providerName);
          },
          inject: [ConfigService],
        },
        {
          provide: RegionService,
          useFactory: (provider: IRegionProvider) => {
            return new RegionService(provider);
          },
          inject: ["REGION_PROVIDER"],
        },
      ],
      exports: [RegionService, "REGION_PROVIDER"],
    };
  }

  /**
   * Get provider instance based on region name
   *
   * Add your custom providers here:
   *
   * case 'california':
   *   const { CaliforniaRegionProvider } = await import('@opuspopuli/region-provider-california');
   *   return new CaliforniaRegionProvider();
   */
  private static async getProviderForRegion(
    region: string,
  ): Promise<IRegionProvider> {
    switch (region.toLowerCase()) {
      // Add custom providers here:
      //
      // case 'california':
      //   const { CaliforniaRegionProvider } = await import('@opuspopuli/region-provider-california');
      //   return new CaliforniaRegionProvider();
      //
      // case 'texas':
      //   const { TexasRegionProvider } = await import('@opuspopuli/region-provider-texas');
      //   return new TexasRegionProvider();

      case "example":
      default:
        return new ExampleRegionProvider();
    }
  }
}
