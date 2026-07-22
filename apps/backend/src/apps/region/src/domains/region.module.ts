import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegionModule } from '@opuspopuli/region-provider';
import {
  QueueModule,
  QueueService,
  STRUCTURAL_ANALYSIS_QUEUE,
} from '@opuspopuli/queue-provider';
import type {
  StructuralAnalysisJobData,
  AnalysisRequestSource,
} from '@opuspopuli/queue-provider';
import {
  ScrapingPipelineModule,
  ScrapingPipelineService,
  MANIFEST_MISSING_CALLBACK,
  EXECUTION_TRACKER_REPOSITORY,
  type ManifestMissingArgs,
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
import { RegionCacheService } from './region-cache.service';
import { RegionSyncService } from './region-sync.service';
import { PropositionsSyncService } from './propositions-sync.service';
import { MeetingsSyncService } from './meetings-sync.service';
import { RepresentativesSyncService } from './representatives-sync.service';
import { CampaignFinanceSyncService } from './campaign-finance-sync.service';
import { CivicsSyncService } from './civics-sync.service';
import { RegionPluginService } from './region-plugin.service';
import { HttpFetcherService } from './http-fetcher.service';
import { RegionQueryService } from './region-query.service';
import { RegionResolver } from './region.resolver';
import {
  CommitteeRelevanceCacheLookup,
  LegislativeCommitteeRelevanceFieldResolver,
  LegislativeCommitteeDetailRelevanceFieldResolver,
} from './legislative-committee-relevance.field.resolver';
import { BioGeneratorService } from './bio-generator.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { EntityActivitySummaryGeneratorService } from './entity-activity-summary-generator.service';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { MinutesSummaryService } from './minutes-summary.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { PropositionFundingService } from './proposition-funding.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { BoundaryLoaderService } from './boundary-loader.service';
import { TigerFetcher } from './boundary-fetchers/tiger.fetcher';
import { GeoportalFetcher } from './boundary-fetchers/geoportal.fetcher';
import { LegislativeCommitteeService } from './legislative-committee.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';
import { PrismaManifestRepository } from '../infrastructure/prisma-manifest-repository';
import { PrismaIngestionWatermarkRepository } from '../infrastructure/prisma-ingestion-watermark-repository';
import { PrismaExecutionTrackerRepository } from '../infrastructure/prisma-execution-tracker-repository';
import { REGION_CACHE } from './region.tokens';
import { PipelineJobService } from './pipeline-job.service';
import { StructuralAnalysisJobService } from './structural-analysis-job.service';
import { randomUUID } from 'crypto';

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
        // QueueModule must be imported here (not just at RegionDomainModule scope)
        // because ScrapingPipelineModule's DI scope cannot see sibling providers.
        QueueModule.forRootAsync(queueModuleAsyncConfig),
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
        PrismaExecutionTrackerRepository,
        {
          provide: EXECUTION_TRACKER_REPOSITORY,
          useExisting: PrismaExecutionTrackerRepository,
        },
        StructuralAnalysisJobService,
        {
          provide: MANIFEST_MISSING_CALLBACK,
          useFactory:
            (
              queueService: QueueService,
              jobService: StructuralAnalysisJobService,
            ) =>
            async (args: ManifestMissingArgs) => {
              // Skip if an analysis job is already queued or running for this source.
              const active = await jobService.findActiveForSource(
                args.regionId,
                args.sourceUrl,
                args.dataType,
              );
              if (active) return;

              const jobId = randomUUID();
              // Enqueue first so the worker can start immediately; create the DB
              // record after. markRunning upserts, so a worker that races ahead
              // before create() completes is handled gracefully.
              const bullmqJobId =
                await queueService.enqueue<StructuralAnalysisJobData>(
                  STRUCTURAL_ANALYSIS_QUEUE,
                  {
                    structuralAnalysisJobId: jobId,
                    regionId: args.regionId,
                    sourceUrl: args.sourceUrl,
                    dataType: args.dataType,
                    contentGoal: args.contentGoal,
                    category: args.category,
                    hints: args.hints,
                    requestedBy: args.requestedBy as AnalysisRequestSource,
                  },
                );
              await jobService.create({
                id: jobId,
                bullmqJobId,
                regionId: args.regionId,
                sourceUrl: args.sourceUrl,
                dataType: args.dataType,
                requestedBy: args.requestedBy as AnalysisRequestSource,
              });
            },
          inject: [QueueService, StructuralAnalysisJobService],
        },
      ],
    }),
  ],
  providers: [
    RegionCacheService,
    RegionPluginService,
    HttpFetcherService,
    RegionSyncService,
    PropositionsSyncService,
    MeetingsSyncService,
    RepresentativesSyncService,
    CampaignFinanceSyncService,
    CivicsSyncService,
    RegionQueryService,
    RegionDomainService,
    RegionResolver,
    CommitteeRelevanceCacheLookup,
    LegislativeCommitteeRelevanceFieldResolver,
    LegislativeCommitteeDetailRelevanceFieldResolver,
    PipelineJobService,
    StructuralAnalysisJobService,
    BioGeneratorService,
    CommitteeSummaryGeneratorService,
    EntityActivitySummaryGeneratorService,
    PropositionAnalysisService,
    MinutesSummaryService,
    PropositionFinanceLinkerService,
    PropositionFundingService,
    LegislativeCommitteeLinkerService,
    LegislativeCommitteeService,
    LegislativeCommitteeDescriptionGeneratorService,
    LegislativeActionLinkerService,
    BoundaryLoaderService,
    TigerFetcher,
    GeoportalFetcher,
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
  exports: [
    RegionDomainService,
    RegionSyncService,
    RegionQueryService,
    PipelineJobService,
    StructuralAnalysisJobService,
    MinutesSummaryService,
    BoundaryLoaderService,
    QueueModule,
    ScrapingPipelineModule,
  ],
})
export class RegionDomainModule {}
