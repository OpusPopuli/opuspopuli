import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegionModule } from '@opuspopuli/region-provider';
import {
  ScrapingPipelineModule,
  ScrapingPipelineService,
} from '@opuspopuli/scraping-pipeline';
import {
  ExtractionModule,
  CacheFactory,
  FallbackCache,
} from '@opuspopuli/extraction-provider';
import { MemoryCache } from '@opuspopuli/common';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';
import { RegionDomainService } from './region.service';
import { RegionResolver } from './region.resolver';
import { RegionScheduler } from './region.scheduler';
import { PrismaManifestRepository } from '../infrastructure/prisma-manifest-repository';
import { REGION_CACHE } from './region.tokens';

// RelationalDbModule is global, no need to import

/**
 * Region Domain Module
 *
 * Provides civic data management for the region.
 * Uses the plugin architecture to dynamically load region providers from DB config.
 * Wires the scraping pipeline for declarative plugin support.
 *
 * LLMModule, ExtractionModule, and MANIFEST_REPOSITORY are passed into
 * ScrapingPipelineModule.forRoot() so they're resolvable within the
 * pipeline module's DI scope (NestJS modules can't access sibling providers).
 */
@Module({
  imports: [
    RegionModule.forPlugins(),
    ScrapingPipelineModule.forRoot({
      imports: [
        LLMModule,
        ExtractionModule,
        PromptClientModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            config: {
              promptServiceUrl: config.get('PROMPT_SERVICE_URL'),
              promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
              hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
            },
          }),
        }),
      ],
      providers: [
        PrismaManifestRepository,
        {
          provide: 'MANIFEST_REPOSITORY',
          useExisting: PrismaManifestRepository,
        },
      ],
    }),
  ],
  providers: [
    RegionDomainService,
    RegionResolver,
    RegionScheduler,
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
  exports: [RegionDomainService],
})
export class RegionDomainModule {}
