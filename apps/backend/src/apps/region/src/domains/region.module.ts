import { Module } from '@nestjs/common';
import { RegionModule } from '@qckstrt/region-provider';
import { RegionDomainService } from './region.service';
import { RegionResolver } from './region.resolver';
import { RegionScheduler } from './region.scheduler';

// PrismaModule is global, no need to import

/**
 * Region Domain Module
 *
 * Provides civic data management for the region.
 * Uses the region provider to fetch and sync data.
 */
@Module({
  imports: [RegionModule.forRootAsync()],
  providers: [RegionDomainService, RegionResolver, RegionScheduler],
  exports: [RegionDomainService],
})
export class RegionDomainModule {}
