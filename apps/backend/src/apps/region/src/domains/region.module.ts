import { Module } from '@nestjs/common';
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
import { RegionDomainService } from './region.service';
import { RegionResolver } from './region.resolver';
import { RegionScheduler } from './region.scheduler';
import { PrismaManifestRepository } from '../infrastructure/prisma-manifest-repository';

export const REGION_CACHE = Symbol('REGION_CACHE');

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
      imports: [LLMModule, ExtractionModule],
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
    {
      provide: REGION_CACHE,
      useFactory: () => {
        const config = CacheFactory.createConfigFromEnv();
        const primary = CacheFactory.createCache<string>({
          ...config,
          keyPrefix: 'region:',
          cacheOptions: { ttlMs: 4 * 60 * 60 * 1000 }, // 4 hours
        });
        const fallback = new MemoryCache<string>({
          ttlMs: 4 * 60 * 60 * 1000,
          maxSize: 200,
        });
        return new FallbackCache<string>(primary, fallback);
      },
    },
  ],
  exports: [RegionDomainService],
})
export class RegionDomainModule {}
