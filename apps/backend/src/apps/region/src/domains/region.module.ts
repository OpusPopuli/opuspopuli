import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegionModule } from '@opuspopuli/region-provider';
import { QueueModule } from '@opuspopuli/queue-provider';
import {
  ScrapingPipelineModule,
  ScrapingPipelineService,
} from '@opuspopuli/scraping-pipeline';
import {
  ExtractionModule,
  CacheFactory,
  FallbackCache,
  OCR_SERVICE,
} from '@opuspopuli/extraction-provider';
import { MemoryCache } from '@opuspopuli/common';
import { LLMModule } from '@opuspopuli/llm-provider';
import { OcrModule, OcrService } from '@opuspopuli/ocr-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';
import { RegionDomainService } from './region.service';
import { RegionResolver } from './region.resolver';
import { RegionScheduler } from './region.scheduler';
import { BioGeneratorService } from './bio-generator.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { EntityActivitySummaryGeneratorService } from './entity-activity-summary-generator.service';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { PropositionFundingService } from './proposition-funding.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { LegislativeCommitteeService } from './legislative-committee.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';
import { PrismaManifestRepository } from '../infrastructure/prisma-manifest-repository';
import { PrismaIngestionWatermarkRepository } from '../infrastructure/prisma-ingestion-watermark-repository';
import { REGION_CACHE } from './region.tokens';
import { PipelineJobService } from './pipeline-job.service';

// RelationalDbModule is global, no need to import

const queueModuleAsyncConfig = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    url: config.get('REDIS_URL') || 'redis://localhost:6379',
    prefix: config.get('BULLMQ_PREFIX') || 'bullmq',
  }),
};

const promptClientAsyncConfig = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    config: {
      promptServiceUrl: config.get('PROMPT_SERVICE_URL'),
      promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
      hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
    },
  }),
};

/**
 * Region Domain Module
 *
 * Provides civic data management for the region.
 * Uses the plugin architecture to dynamically load region providers from DB config.
 * Wires the scraping pipeline for declarative plugin support.
 *
 * LLMModule and PromptClientModule are imported at both the top level (for
 * BioGeneratorService) and inside ScrapingPipelineModule.forRoot() (for the
 * pipeline's internal services). NestJS modules can't access sibling
 * providers across scopes, so each scope needs its own import.
 */
@Module({
  imports: [
    RegionModule.forPlugins(),
    LLMModule,
    QueueModule.forRootAsync(queueModuleAsyncConfig),
    PromptClientModule.forRootAsync(promptClientAsyncConfig),
    ScrapingPipelineModule.forRoot({
      imports: [
        LLMModule,
        // ExtractionModule.forRoot is configured below to import OcrModule
        // and bind the OCR_SERVICE token inside ExtractionModule's own DI
        // scope — that's what ExtractionProvider injects, and providers
        // declared at ScrapingPipelineModule's scope are NOT visible to it.
        ExtractionModule.forRoot({
          extraImports: [OcrModule],
          extraProviders: [
            {
              provide: OCR_SERVICE,
              useExisting: OcrService,
            },
          ],
        }),
        PromptClientModule.forRootAsync(promptClientAsyncConfig),
      ],
      providers: [
        PrismaManifestRepository,
        {
          provide: 'MANIFEST_REPOSITORY',
          useExisting: PrismaManifestRepository,
        },
        PrismaIngestionWatermarkRepository,
        {
          provide: 'INGESTION_WATERMARK_REPOSITORY',
          useExisting: PrismaIngestionWatermarkRepository,
        },
      ],
    }),
  ],
  providers: [
    RegionDomainService,
    RegionResolver,
    RegionScheduler,
    PipelineJobService,
    BioGeneratorService,
    CommitteeSummaryGeneratorService,
    EntityActivitySummaryGeneratorService,
    PropositionAnalysisService,
    PropositionFinanceLinkerService,
    PropositionFundingService,
    LegislativeCommitteeLinkerService,
    LegislativeCommitteeService,
    LegislativeCommitteeDescriptionGeneratorService,
    LegislativeActionLinkerService,
    // Alias for injecting the pipeline into RegionDomainService
    {
      provide: 'SCRAPING_PIPELINE',
      useExisting: ScrapingPipelineService,
    },
    // Redis-backed cache with in-memory fallback for region reference data (#459)
    // Disabled in test to prevent stale cached data between E2E test cases
    {
      provide: REGION_CACHE,
      useFactory: () => {
        const isTest = process.env.NODE_ENV === 'test';
        const ttlMs = isTest ? 0 : 4 * 60 * 60 * 1000; // disabled in test, 4h in prod

        const config = CacheFactory.createConfigFromEnv();
        const primary = CacheFactory.createCache<string>({
          ...config,
          keyPrefix: 'region:',
          cacheOptions: { ttlMs },
        });
        const fallback = new MemoryCache<string>({
          ttlMs,
          maxSize: 200,
        });
        return new FallbackCache<string>(primary, fallback);
      },
    },
  ],
  exports: [RegionDomainService, PipelineJobService, QueueModule],
})
export class RegionDomainModule {}
