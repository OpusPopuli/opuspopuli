/**
 * Scraping Pipeline Module
 *
 * NestJS module that provides the AI-powered scraping pipeline.
 * Depends on LLM_PROVIDER, ExtractionProvider, and a ManifestRepository.
 */

import { Module, type DynamicModule } from "@nestjs/common";
import { ScrapingPipelineService } from "./pipeline/pipeline.service.js";
import {
  ExecutionTrackerService,
  EXECUTION_TRACKER_REPOSITORY,
  type ExecutionTrackerRepository,
} from "./pipeline/execution-tracker.service.js";
import { StructuralAnalyzerService } from "./analysis/structural-analyzer.service.js";
import {
  ManifestStoreService,
  type ManifestRepository,
} from "./manifest/manifest-store.service.js";
import {
  IngestionWatermarkService,
  type IngestionWatermarkRepository,
} from "./manifest/ingestion-watermark.service.js";
import { ManifestExtractorService } from "./extraction/manifest-extractor.service.js";
import { ExtractionValidator } from "./extraction/extraction-validator.js";
import { DomainMapperService } from "./mapping/domain-mapper.service.js";
import { SelfHealingService } from "./healing/self-healing.service.js";
import { BulkDownloadHandler } from "./handlers/bulk-download.handler.js";
import { ApiIngestHandler } from "./handlers/api-ingest.handler.js";
import { PdfExtractHandler } from "./handlers/pdf-extract.handler.js";
import { MinutesIngestHandler } from "./handlers/minutes-ingest.handler.js";
import { TextExtractorService } from "./extraction/text-extractor.service.js";
import { DetailCrawlerService } from "./crawling/detail-crawler.service.js";

export interface ManifestMissingArgs {
  regionId: string;
  sourceUrl: string;
  dataType: string;
  contentGoal?: string;
  category?: string;
  hints?: string[];
  requestedBy: "cache_miss" | "cache_stale" | "manual";
}

export const MANIFEST_MISSING_CALLBACK = "MANIFEST_MISSING_CALLBACK";

export interface ScrapingPipelineModuleOptions {
  /** Modules that provide required tokens (LLM_PROVIDER, ExtractionProvider, etc.) */
  imports?: any[];
  /**
   * Additional providers. To enable async manifest analysis, include a
   * { provide: MANIFEST_MISSING_CALLBACK, useFactory: ..., inject: [...] }
   * provider here. Omit it (or provide null) to keep the original inline
   * LLM-analysis behaviour.
   */
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
   *
   * PromptClientModule must be provided by the caller via options.imports
   * (configured with forRootAsync to connect to the remote prompt service).
   */
  static forRoot(options?: ScrapingPipelineModuleOptions): DynamicModule {
    return {
      module: ScrapingPipelineModule,
      imports: [...(options?.imports || [])],
      providers: [
        ...(options?.providers || []),
        // Manifest store (wraps the injected repository)
        {
          provide: ManifestStoreService,
          useFactory: (repository: ManifestRepository) =>
            new ManifestStoreService(repository),
          inject: ["MANIFEST_REPOSITORY"],
        },
        // Watermark store (wraps the injected repository — optional;
        // consumers without listing-walk sources can omit the binding
        // and MinutesIngestHandler still functions, just without
        // cold-start protection).
        {
          provide: IngestionWatermarkService,
          useFactory: (repository?: IngestionWatermarkRepository) =>
            repository ? new IngestionWatermarkService(repository) : undefined,
          inject: [{ token: "INGESTION_WATERMARK_REPOSITORY", optional: true }],
        },
        // Execution tracker (optional — disabled when EXECUTION_TRACKER_REPOSITORY not bound)
        {
          provide: ExecutionTrackerService,
          useFactory: (repository?: ExecutionTrackerRepository) =>
            new ExecutionTrackerService(repository ?? null),
          inject: [{ token: EXECUTION_TRACKER_REPOSITORY, optional: true }],
        },
        // Core services
        StructuralAnalyzerService,
        ManifestExtractorService,
        ExtractionValidator,
        DomainMapperService,
        SelfHealingService,
        // Streaming handlers wired manually so they receive ExecutionTrackerService
        // without a parameter decorator (avoids reflect-metadata requirement in tests).
        {
          provide: BulkDownloadHandler,
          useFactory: (
            mapper: DomainMapperService,
            tracker?: ExecutionTrackerService,
          ) => new BulkDownloadHandler(mapper, tracker ?? null),
          inject: [
            DomainMapperService,
            { token: ExecutionTrackerService, optional: true },
          ],
        },
        {
          provide: ApiIngestHandler,
          useFactory: (
            mapper: DomainMapperService,
            tracker?: ExecutionTrackerService,
          ) => new ApiIngestHandler(mapper, tracker ?? null),
          inject: [
            DomainMapperService,
            { token: ExecutionTrackerService, optional: true },
          ],
        },
        PdfExtractHandler,
        MinutesIngestHandler,
        TextExtractorService,
        DetailCrawlerService,
        ScrapingPipelineService,
      ],
      exports: [
        ScrapingPipelineService,
        ExecutionTrackerService,
        StructuralAnalyzerService,
        ManifestStoreService,
        IngestionWatermarkService,
        ManifestExtractorService,
        DomainMapperService,
      ],
    };
  }
}
