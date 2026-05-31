import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggingModule } from '@opuspopuli/logging-provider';
import { SecretsModule } from '@opuspopuli/secrets-provider';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';
import { QueueModule } from '@opuspopuli/queue-provider';

import { DbModule } from 'src/db/db.module';
import { HealthModule } from 'src/common/health';
import { MetricsModule } from 'src/common/metrics';
import { createLoggingConfig } from 'src/common/config/shared-app.config';

import configuration from 'src/config';
import relationaldbConfig from 'src/config/relationaldb.config';
import { regionValidationSchema } from 'src/config/env.validation';

import { ScoringService } from 'src/apps/knowledge/src/domains/personalized-feed/scoring.service';
import { PersonalizedFeedService } from 'src/apps/knowledge/src/domains/personalized-feed/personalized-feed.service';
import { LlmRerankService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank.service';
import { LlmRerankJobService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank-job.service';
import { ExplanationValidatorService } from 'src/apps/knowledge/src/domains/personalized-feed/explanation-validator.service';
import { CostBudgetService } from 'src/apps/knowledge/src/domains/personalized-feed/cost-budget.service';

import { LlmRerankProcessor } from './llm-rerank.processor';
import { LlmRerankScheduler } from './llm-rerank.scheduler';

/**
 * Worker process for the `llm-rerank` BullMQ queue (#745).
 *
 *   - Cron scheduler enqueues one job per active user nightly
 *     (defaults to 3 AM UTC; opt-out via LLM_RERANK_CRON_ENABLED=false).
 *   - Mutation `triggerMyLlmRerank` in the knowledge service enqueues
 *     a single user's job on demand.
 *   - Processor consumes the queue, runs LlmRerankService.rerankForUser,
 *     writes `llm_rerank_jobs` status row.
 *
 * Imports `LlmRerankService` + dependencies from the knowledge service
 * by direct path — that service is the canonical per-user work unit and
 * gets reused verbatim by both the worker (cron + queue path) and the
 * resolver mutation. Same module-as-library pattern that the
 * region-worker uses for `RegionDomainService`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration, relationaldbConfig],
      validationSchema: regionValidationSchema,
      validationOptions: { abortEarly: false },
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    LoggingModule.forRootAsync(createLoggingConfig('llm-rerank-worker')),
    DbModule.forRoot(),
    SecretsModule,
    LLMModule,
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
    QueueModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        prefix: config.get<string>('BULLMQ_PREFIX') ?? 'bullmq',
      }),
    }),
    MetricsModule.forRoot({ serviceName: 'llm-rerank-worker' }),
    HealthModule.forRoot({
      serviceName: 'llm-rerank-worker',
      hasDatabase: true,
    }),
  ],
  providers: [
    // Reused from knowledge service (module-as-library)
    ScoringService,
    PersonalizedFeedService,
    LlmRerankService,
    LlmRerankJobService,
    ExplanationValidatorService,
    CostBudgetService,
    // Worker-local
    LlmRerankProcessor,
    LlmRerankScheduler,
  ],
})
export class LlmRerankWorkerModule {}
