import { Module, DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IRegionProvider } from "@opuspopuli/common";
import { RegionService } from "./region.service.js";
import { ExampleRegionProvider } from "./providers/example.provider.js";

/**
 * Region Module
 *
 * Configures Dependency Injection for region providers.
 *
 * To swap providers, set the REGION_PROVIDER environment variable:
 * - example (default): Mock data for development
 * - california: California civic data (requires region-provider-california package)
 * - Add your own implementation of IRegionProvider
 *
 * For custom providers:
 * 1. Create a package implementing IRegionProvider
 * 2. Register it in getProviderForRegion() below
 * 3. Set REGION_PROVIDER=your-region in .env
 */
@Module({})
export class RegionModule {
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
