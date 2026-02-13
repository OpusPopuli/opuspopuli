import { Module } from '@nestjs/common';
import { RegionModule } from '@opuspopuli/region-provider';
import { RegionDomainService } from './region.service';
import { RegionResolver } from './region.resolver';
import { RegionScheduler } from './region.scheduler';

// RelationalDbModule is global, no need to import

/**
 * Region Domain Module
 *
 * Provides civic data management for the region.
 * Uses the plugin architecture to dynamically load region providers from DB config.
 */
@Module({
  imports: [RegionModule.forPlugins()],
  providers: [RegionDomainService, RegionResolver, RegionScheduler],
  exports: [RegionDomainService],
})
export class RegionDomainModule {}
