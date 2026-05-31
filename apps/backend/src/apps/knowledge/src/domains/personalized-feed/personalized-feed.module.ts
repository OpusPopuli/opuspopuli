import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';
import { QueueModule } from '@opuspopuli/queue-provider';

import { ScoringService } from './scoring.service';
import { PersonalizedFeedService } from './personalized-feed.service';
import { PersonalizedFeedResolver } from './personalized-feed.resolver';
import { LlmRerankService } from './llm-rerank.service';
import { LlmRerankJobService } from './llm-rerank-job.service';
import { ExplanationValidatorService } from './explanation-validator.service';
import { CostBudgetService } from './cost-budget.service';

/**
 * Personalized bill feed (#743 + #745).
 *
 *   - v1.0 ranker: tag-overlap scoring against the bill-analysis
 *     controlled vocabularies (#743). Reads bills directly from the
 *     shared DB via DbService — documented cross-service shortcut,
 *     replaced by federation in #761.
 *   - v1.0 LLM re-rank (#745): nightly batch (cron in a follow-up
 *     subtask) calls prompt-service `bill-relevance-explanation` per
 *     user/bill and caches the LLM-written "why this matters to you"
 *     sentence on `PersonalizedFeedCache`. The resolver overlays the
 *     cached sentence onto the embedding-only result.
 */
@Module({
  imports: [
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
    // QueueModule lets the resolver mutation enqueue an llm-rerank job
    // for the worker to process. The actual rerank service is also
    // provided here so the worker can re-use it via direct module-as-
    // library import (matches RegionDomainService pattern).
    QueueModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        prefix: config.get<string>('BULLMQ_PREFIX') ?? 'bullmq',
      }),
    }),
  ],
  providers: [
    ScoringService,
    PersonalizedFeedService,
    PersonalizedFeedResolver,
    LlmRerankService,
    LlmRerankJobService,
    ExplanationValidatorService,
    CostBudgetService,
  ],
  exports: [PersonalizedFeedService, ScoringService, LlmRerankService],
})
export class PersonalizedFeedModule {}
