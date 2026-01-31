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
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';
import { LoggingModule } from '@qckstrt/logging-provider';
import depthLimit from 'graphql-depth-limit';
import { createQueryComplexityValidationRule } from 'src/common/graphql/query-complexity.plugin';

import { KnowledgeModule } from './domains/knowledge.module';

import configuration from 'src/config';
import supabaseConfig from 'src/config/supabase.config';
import storageConfig from 'src/config/storage.config';
import authConfig from 'src/config/auth.config';
import secretsConfig from 'src/config/secrets.config';
import relationaldbConfig from 'src/config/relationaldb.config';

import { LoggerMiddleware } from 'src/common/middleware/logger.middleware';
import { HMACMiddleware } from 'src/common/middleware/hmac.middleware';
import {
  THROTTLER_CONFIG,
  SHARED_PROVIDERS,
  createLoggingConfig,
} from 'src/common/config/shared-app.config';
import { DbModule } from 'src/db/db.module';
import { AuditModule } from 'src/common/audit/audit.module';
import { CaslModule } from 'src/permissions/casl.module';
import { HealthModule } from 'src/common/health';
import { MetricsModule } from 'src/common/metrics';

/**
 * Knowledge App Module
 *
 * Handles semantic search and RAG operations.
 * Uses pgvector for vector storage and embeddings for text processing.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [
        configuration,
        supabaseConfig,
        storageConfig,
        authConfig,
        secretsConfig,
        relationaldbConfig,
      ],
      isGlobal: true,
    }),
    LoggingModule.forRootAsync(createLoggingConfig('knowledge-service')),
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
    DbModule.forRoot(),
    AuditModule.forRoot(),
    GraphQLModule.forRoot<ApolloFederationDriverConfig>({
      driver: ApolloFederationDriver,
      autoSchemaFile: { path: 'knowledge-schema.gql', federation: 2 },
      plugins: [ApolloServerPluginInlineTrace()],
      validationRules: [depthLimit(10), createQueryComplexityValidationRule()],
      context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
    }),
    CaslModule.forRoot(),
    KnowledgeModule,
    HealthModule.forRoot({
      serviceName: 'knowledge-service',
      hasDatabase: true,
    }),
    MetricsModule.forRoot({ serviceName: 'knowledge-service' }),
  ],
  providers: SHARED_PROVIDERS,
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      // SECURITY: Validate HMAC signature from API Gateway
      // Only requests signed by the gateway are accepted
      // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/185
      .apply(HMACMiddleware, LoggerMiddleware)
      .exclude(
        // Health endpoints are excluded from HMAC validation for Kubernetes probes
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
        // Metrics endpoint excluded for Prometheus scraping
        { path: 'metrics', method: RequestMethod.GET },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
