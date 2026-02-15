/**
 * Scraping Pipeline Module
 *
 * NestJS module that provides the AI-powered scraping pipeline.
 * Depends on LLM_PROVIDER, ExtractionProvider, and a ManifestRepository.
 */

import { Module, type DynamicModule } from "@nestjs/common";
import { ScrapingPipelineService } from "./pipeline/pipeline.service.js";
import { StructuralAnalyzerService } from "./analysis/structural-analyzer.service.js";
import {
  PromptClientService,
  type PromptClientConfig,
} from "./analysis/prompt-client.service.js";
import {
  ManifestStoreService,
  type ManifestRepository,
} from "./manifest/manifest-store.service.js";
import { ManifestExtractorService } from "./extraction/manifest-extractor.service.js";
import { ExtractionValidator } from "./extraction/extraction-validator.js";
import { DomainMapperService } from "./mapping/domain-mapper.service.js";
import { SelfHealingService } from "./healing/self-healing.service.js";

export interface ScrapingPipelineModuleOptions {
  /** Configuration for the prompt client (remote or local) */
  promptClientConfig?: PromptClientConfig;
  /** Modules that provide required tokens (LLM_PROVIDER, ExtractionProvider, etc.) */
  imports?: any[];
  /** Additional providers (e.g., MANIFEST_REPOSITORY) */
  providers?: any[];
}

@Module({})
export class ScrapingPipelineModule {
  /**
   * Register the scraping pipeline module.
   *
   * Required dependencies (pass via options.imports / options.providers):
   * - LLM_PROVIDER: ILLMProvider implementation (from LLMModule)
   * - ExtractionProvider: for fetching HTML (from ExtractionModule)
   * - MANIFEST_REPOSITORY: ManifestRepository implementation (Prisma adapter)
   */
  static forRoot(options?: ScrapingPipelineModuleOptions): DynamicModule {
    return {
      module: ScrapingPipelineModule,
      imports: options?.imports || [],
      providers: [
        ...(options?.providers || []),
        // Prompt client (connects to AI Prompt Service or uses local fallback)
        {
          provide: PromptClientService,
          useFactory: () =>
            new PromptClientService(options?.promptClientConfig),
        },
        // Manifest store (wraps the injected repository)
        {
          provide: ManifestStoreService,
          useFactory: (repository: ManifestRepository) =>
            new ManifestStoreService(repository),
          inject: ["MANIFEST_REPOSITORY"],
        },
        // Core services
        StructuralAnalyzerService,
        ManifestExtractorService,
        ExtractionValidator,
        DomainMapperService,
        SelfHealingService,
        ScrapingPipelineService,
      ],
      exports: [
        ScrapingPipelineService,
        StructuralAnalyzerService,
        ManifestStoreService,
        ManifestExtractorService,
        DomainMapperService,
      ],
    };
  }
}
