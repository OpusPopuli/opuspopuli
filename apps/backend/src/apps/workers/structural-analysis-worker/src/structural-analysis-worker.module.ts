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

import { StructuralAnalysisProcessor } from './structural-analysis.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration, relationaldbConfig, regionConfig],
      validationSchema: regionValidationSchema,
      validationOptions: { abortEarly: false },
      isGlobal: true,
    }),
    LoggingModule.forRootAsync(
      createLoggingConfig('structural-analysis-worker'),
    ),
    DbModule.forRoot(),
    SecretsModule,
    RegionDomainModule,
    MetricsModule.forRoot({ serviceName: 'structural-analysis-worker' }),
    HealthModule.forRoot({
      serviceName: 'structural-analysis-worker',
      hasDatabase: true,
    }),
  ],
  providers: [StructuralAnalysisProcessor],
})
export class StructuralAnalysisWorkerModule {}
