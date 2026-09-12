import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@opuspopuli/logging-provider';
import { SecretsModule } from '@opuspopuli/secrets-provider';
import { regionConfig } from '@opuspopuli/config-provider';

import { RegionDomainModule } from 'src/apps/region/src/domains/region.module';
import { DbModule } from 'src/db/db.module';
import {
  HealthModule,
  parseRssThreshold,
  BULK_WORKLOAD_RSS_THRESHOLD,
} from 'src/common/health';
import { MetricsModule } from 'src/common/metrics';
import { createLoggingConfig } from 'src/common/config/shared-app.config';

import configuration from 'src/config';
import relationaldbConfig from 'src/config/relationaldb.config';
import { regionValidationSchema } from 'src/config/env.validation';

import { RegionSyncProcessor } from './region-sync.processor';
import { RegionSyncScheduler } from './region-sync.scheduler';
import { MinutesSummaryProcessor } from './minutes-summary.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration, relationaldbConfig, regionConfig],
      validationSchema: regionValidationSchema,
      validationOptions: { abortEarly: false },
      isGlobal: true,
    }),
    LoggingModule.forRootAsync(createLoggingConfig('region-worker')),
    DbModule.forRoot(),
    SecretsModule,
    RegionDomainModule,
    MetricsModule.forRoot({ serviceName: 'region-worker' }),
    // Bulk-workload RSS threshold, not the 1 GB default.
    //
    // #642 raised this on `region-service` because the CalAccess bulk download
    // hit 1.7 GB against a 6 GB container limit. Its comment then said the
    // other services could keep the lower default since "they don't do
    // bulk-download work" — true when written, and false since #1122 moved
    // `syncRegionData` and `refreshBoundaries` onto the `region-sync` queue.
    // The work moved here; the threshold did not follow it.
    //
    // Measured 2026-09-12 (#1236): a proposition sync that scrapes two sites,
    // fetches PDFs and runs extraction peaks at 1.35 GB RSS and does not return
    // it to the OS (`external` ~394 MB of HTML and PDF buffers). The worker
    // then reported unhealthy for 538 consecutive checks — `restart:
    // unless-stopped` restarts on exit, not on unhealthy, so nothing recovers
    // it. A sync with no new data stays at 283 MB, so this is the cost of doing
    // the work rather than accumulation across runs.
    HealthModule.forRoot({
      serviceName: 'region-worker',
      hasDatabase: true,
      memoryRssThreshold: parseRssThreshold(
        process.env.MEMORY_RSS_THRESHOLD_BYTES,
        BULK_WORKLOAD_RSS_THRESHOLD,
      ),
    }),
  ],
  providers: [
    RegionSyncProcessor,
    RegionSyncScheduler,
    MinutesSummaryProcessor,
  ],
})
export class RegionWorkerModule {}
