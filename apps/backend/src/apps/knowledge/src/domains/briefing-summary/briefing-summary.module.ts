import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMModule } from '@opuspopuli/llm-provider';
import { PromptClientModule } from '@opuspopuli/prompt-client';
import { BriefingSummaryService } from './briefing-summary.service';
import { BriefingSummaryResolver } from './briefing-summary.resolver';
import { BriefingSummaryValidatorService } from './briefing-summary-validator.service';

const promptClientAsyncConfig = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    config: {
      promptServiceUrl: config.get('PROMPT_SERVICE_URL'),
      promptServiceApiKey: config.get('PROMPT_SERVICE_API_KEY'),
      hmacNodeId: config.get('PROMPT_SERVICE_NODE_ID'),
    },
  }),
};

/**
 * Personalized briefing-summary module (#849 Phase 2). Owns the
 * GraphQL `myBriefingSummary` query that backs the LLM-polished
 * paragraph at the top of `/me/briefing` — paired with the always-on
 * Phase 1 template fallback on the frontend.
 *
 * Sits alongside the per-entity rerank modules (`personalized-feed`,
 * `personalized-reps`, `personalized-propositions`) rather than
 * extending one of them, because briefing-summary is its own
 * lifecycle — one paragraph per user, not per-bill — and pulls a
 * disjoint set of dependencies (briefing-summary prompt + validator)
 * we don't want bleeding into the bill rerank wiring.
 */
@Module({
  imports: [
    LLMModule,
    PromptClientModule.forRootAsync(promptClientAsyncConfig),
  ],
  providers: [
    BriefingSummaryService,
    BriefingSummaryValidatorService,
    BriefingSummaryResolver,
  ],
  exports: [BriefingSummaryService],
})
export class BriefingSummaryModule {}
