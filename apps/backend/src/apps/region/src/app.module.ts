import {
  ApolloFederationDriver,
  ApolloFederationDriverConfig,
} from '@nestjs/apollo';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggingModule } from '@opuspopuli/logging-provider';
import depthLimit from 'graphql-depth-limit';
import { createQueryComplexityPlugin } from 'src/common/graphql/query-complexity.plugin';

import { RegionDomainModule } from './domains/region.module';

import configuration from 'src/config';
import relationaldbConfig from 'src/config/relationaldb.config';
import { regionConfig } from '@opuspopuli/config-provider';
import { regionValidationSchema } from 'src/config/env.validation';

import { LoggerMiddleware } from 'src/common/middleware/logger.middleware';
import {
  THROTTLER_CONFIG,
  SHARED_PROVIDERS,
  GRAPHQL_INTROSPECTION_ENABLED,
  createLoggingConfig,
  createSubgraphPlugins,
} from 'src/common/config/shared-app.config';
import { DbModule } from 'src/db/db.module';
import { AuditModule } from 'src/common/audit/audit.module';
import { CaslModule } from 'src/permissions/casl.module';
import { HealthModule } from 'src/common/health';
import { MetricsModule } from 'src/common/metrics';
import { SecretsModule } from '@opuspopuli/secrets-provider';

/**
 * Parse a positive integer byte count from an env var; fall back to
 * `defaultBytes` if absent or invalid. Used by the HealthModule config
 * below to override the in-process default RSS threshold per deployment.
 */
function parseRssThreshold(
  raw: string | undefined,
  defaultBytes: number,
): number {
  if (!raw) return defaultBytes;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultBytes;
}

/**
 * Region App Module
 *
 * Handles civic data management for the region.
 * Syncs propositions, meetings, and representatives from the configured region provider.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration, relationaldbConfig, regionConfig],
      validationSchema: regionValidationSchema,
      validationOptions: { abortEarly: false },
      isGlobal: true,
    }),
    LoggingModule.forRootAsync(createLoggingConfig('region-service')),
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
    ScheduleModule.forRoot(),
    DbModule.forRoot(),
    AuditModule.forRoot(),
    GraphQLModule.forRoot<ApolloFederationDriverConfig>({
      driver: ApolloFederationDriver,
      autoSchemaFile: { path: 'region-schema.gql', federation: 2 },
      plugins: [
        ...createSubgraphPlugins('region-service'),
        createQueryComplexityPlugin(),
      ],
      validationRules: [depthLimit(10)],
      introspection: GRAPHQL_INTROSPECTION_ENABLED,
      context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
    }),
    CaslModule.forRoot(),
    SecretsModule,
    RegionDomainModule,
    // Region's RSS legitimately spikes to ~1.7GB during CalAccess bulk
    // download (~3M contributions, ~70K committee stubs accumulated in
    // memory before flush). Container memory limit is 6GB; the healthcheck
    // threshold needs to be well above the observed spike but well below
    // the container limit. 3GB lands in the right zone — masks no real
    // OOM risk and stops the false-alarm spam during legitimate sync.
    // Other services (users, documents, knowledge, api) keep the 1GB
    // default — they don't do bulk-download work, so a lower threshold
    // there still catches real memory leaks. See #642.
    HealthModule.forRoot({
      serviceName: 'region-service',
      hasDatabase: true,
      memoryRssThreshold: parseRssThreshold(
        process.env.MEMORY_RSS_THRESHOLD_BYTES,
        3 * 1024 * 1024 * 1024,
      ),
    }),
    MetricsModule.forRoot({ serviceName: 'region-service' }),
  ],
  providers: SHARED_PROVIDERS,
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
