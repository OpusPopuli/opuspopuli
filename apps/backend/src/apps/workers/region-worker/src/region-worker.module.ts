import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@opuspopuli/logging-provider';
import { SecretsModule } from '@opuspopuli/secrets-provider';
import { regionConfig } from '@opuspopuli/config-provider';

import { RegionDomainModule } from 'src/apps/region/src/domains/region.module';
import { DbModule } from 'src/db/db.module';
import { HealthModule } from 'src/common/health';
import { MetricsModule } from 'src/common/metrics';
import { createLoggingConfig } from 'src/common/config/shared-app.config';

import configuration from 'src/config';
import relationaldbConfig from 'src/config/relationaldb.config';
import { regionValidationSchema } from 'src/config/env.validation';

import { RegionSyncProcessor } from './region-sync.processor';
import { RegionSyncScheduler } from './region-sync.scheduler';

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
    HealthModule.forRoot({ serviceName: 'region-worker', hasDatabase: true }),
  ],
  providers: [RegionSyncProcessor, RegionSyncScheduler],
})
export class RegionWorkerModule {}
