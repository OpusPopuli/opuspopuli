import { Module } from '@nestjs/common';
import { RegionModule } from '@opuspopuli/region-provider';
import {
  ScrapingPipelineModule,
  ScrapingPipelineService,
} from '@opuspopuli/scraping-pipeline';
import { ExtractionModule } from '@opuspopuli/extraction-provider';
import { LLMModule } from '@opuspopuli/llm-provider';
import { RegionDomainService } from './region.service';
import { RegionResolver } from './region.resolver';
import { RegionScheduler } from './region.scheduler';
import { PrismaManifestRepository } from '../infrastructure/prisma-manifest-repository';

// RelationalDbModule is global, no need to import

/**
 * Region Domain Module
 *
 * Provides civic data management for the region.
 * Uses the plugin architecture to dynamically load region providers from DB config.
 * Wires the scraping pipeline for declarative plugin support.
 */
@Module({
  imports: [
    RegionModule.forPlugins(),
    LLMModule,
    ExtractionModule,
    ScrapingPipelineModule.forRoot(),
  ],
  providers: [
    RegionDomainService,
    RegionResolver,
    RegionScheduler,
    PrismaManifestRepository,
    {
      provide: 'MANIFEST_REPOSITORY',
      useExisting: PrismaManifestRepository,
    },
    {
      provide: 'SCRAPING_PIPELINE',
      useExisting: ScrapingPipelineService,
    },
  ],
  exports: [RegionDomainService],
})
export class RegionDomainModule {}
