import { DynamicModule, Module, Provider } from "@nestjs/common";
import { TextExtractionService } from "./extraction.service.js";
import { ITextExtractor } from "@opuspopuli/common";
import { URLExtractor } from "./extractors/url.extractor.js";
import { ExtractionProvider } from "./extraction.provider.js";
import {
  ExtractionConfig,
  DEFAULT_EXTRACTION_CONFIG,
  EXTRACTION_CONFIG,
} from "./types.js";

/**
 * Module configuration options
 */
export interface ExtractionModuleOptions {
  config?: Partial<ExtractionConfig>;
}

/**
 * Extraction Module
 *
 * Configures Dependency Injection for text extraction strategies.
 *
 * Usage:
 * ```typescript
 * // With default config
 * @Module({
 *   imports: [ExtractionModule],
 * })
 *
 * // With custom config
 * @Module({
 *   imports: [ExtractionModule.forRoot({
 *     config: {
 *       rateLimit: { requestsPerSecond: 5 },
 *       cache: { ttlMs: 60000 },
 *     },
 *   })],
 * })
 *
 * // With async config (e.g., from ConfigService)
 * @Module({
 *   imports: [ExtractionModule.forRootAsync({
 *     imports: [ConfigModule],
 *     inject: [ConfigService],
 *     useFactory: (configService: ConfigService) => ({
 *       config: configService.get('extraction'),
 *     }),
 *   })],
 * })
 * ```
 */
@Module({
  providers: [
    // Default config provider
    {
      provide: EXTRACTION_CONFIG,
      useValue: DEFAULT_EXTRACTION_CONFIG,
    },
    // ExtractionProvider - infrastructure layer
    ExtractionProvider,
    // Individual extractor implementations
    URLExtractor,
    // Array of all extractors (injected into TextExtractionService)
    {
      provide: "TEXT_EXTRACTORS",
      useFactory: (urlExtractor: URLExtractor): ITextExtractor[] => {
        return [urlExtractor];
      },
      inject: [URLExtractor],
    },
    // Main service that uses the extractors
    {
      provide: TextExtractionService,
      useFactory: (extractors: ITextExtractor[]) => {
        return new TextExtractionService(extractors);
      },
      inject: ["TEXT_EXTRACTORS"],
    },
  ],
  exports: [TextExtractionService, ExtractionProvider],
})
export class ExtractionModule {
  /**
   * Configure the module with custom options
   */
  static forRoot(options: ExtractionModuleOptions = {}): DynamicModule {
    const mergedConfig: ExtractionConfig = {
      ...DEFAULT_EXTRACTION_CONFIG,
      ...options.config,
      cache: {
        ...DEFAULT_EXTRACTION_CONFIG.cache,
        ...options.config?.cache,
      },
      rateLimit: {
        ...DEFAULT_EXTRACTION_CONFIG.rateLimit,
        ...options.config?.rateLimit,
      },
      retry: {
        ...DEFAULT_EXTRACTION_CONFIG.retry,
        ...options.config?.retry,
      },
    };

    return {
      module: ExtractionModule,
      providers: [
        {
          provide: EXTRACTION_CONFIG,
          useValue: mergedConfig,
        },
        ExtractionProvider,
        URLExtractor,
        {
          provide: "TEXT_EXTRACTORS",
          useFactory: (urlExtractor: URLExtractor): ITextExtractor[] => {
            return [urlExtractor];
          },
          inject: [URLExtractor],
        },
        {
          provide: TextExtractionService,
          useFactory: (extractors: ITextExtractor[]) => {
            return new TextExtractionService(extractors);
          },
          inject: ["TEXT_EXTRACTORS"],
        },
      ],
      exports: [TextExtractionService, ExtractionProvider],
    };
  }

  /**
   * Configure the module asynchronously (e.g., with ConfigService)
   */
  static forRootAsync(options: {
    imports?: any[];
    inject?: any[];
    useFactory: (
      ...args: any[]
    ) => ExtractionModuleOptions | Promise<ExtractionModuleOptions>;
  }): DynamicModule {
    const configProvider: Provider = {
      provide: EXTRACTION_CONFIG,
      useFactory: async (...args: any[]) => {
        const moduleOptions = await options.useFactory(...args);
        return {
          ...DEFAULT_EXTRACTION_CONFIG,
          ...moduleOptions.config,
          cache: {
            ...DEFAULT_EXTRACTION_CONFIG.cache,
            ...moduleOptions.config?.cache,
          },
          rateLimit: {
            ...DEFAULT_EXTRACTION_CONFIG.rateLimit,
            ...moduleOptions.config?.rateLimit,
          },
          retry: {
            ...DEFAULT_EXTRACTION_CONFIG.retry,
            ...moduleOptions.config?.retry,
          },
        };
      },
      inject: options.inject || [],
    };

    return {
      module: ExtractionModule,
      imports: options.imports || [],
      providers: [
        configProvider,
        ExtractionProvider,
        URLExtractor,
        {
          provide: "TEXT_EXTRACTORS",
          useFactory: (urlExtractor: URLExtractor): ITextExtractor[] => {
            return [urlExtractor];
          },
          inject: [URLExtractor],
        },
        {
          provide: TextExtractionService,
          useFactory: (extractors: ITextExtractor[]) => {
            return new TextExtractionService(extractors);
          },
          inject: ["TEXT_EXTRACTORS"],
        },
      ],
      exports: [TextExtractionService, ExtractionProvider],
    };
  }
}
