import { Module } from '@nestjs/common';

import { PersonalizedFeedModule } from '../personalized-feed/personalized-feed.module';
import { PersonalizedRepActivityService } from './personalized-rep-activity.service';
import { PersonalizedRepsResolver } from './personalized-reps.resolver';
import { RepRelevanceService } from './rep-relevance.service';

/**
 * Personalized rep-activity briefing (#769).
 *
 * Phase 1: heuristic 3-axis scoring of the user's chamber-level
 * representatives against their RankingFlags + interestTags + recent
 * sponsorships/co-sponsorships on bills the bill ranker (#743/#745)
 * already considers relevant. Reads representatives + sponsorships
 * directly from the shared DB via DbService — documented cross-service
 * shortcut, mirrors the bill (#743) and proposition (#771) rankers.
 * Federation refactor at #761.
 *
 * Phase 2 follow-ups (not in this module yet):
 *   - LLM rerank for rep-activity explanations (reuses
 *     llm-rerank-worker infra from #745 with a new prompt-service
 *     template — see relevanceExplanation field on result model)
 *   - Endorsement-driven coalition axis (axis 5) — gated on the same
 *     endorsement-data pipeline blocking #771's prop coalition axis
 *
 * Orchestrator + resolver are added in subsequent subtasks (#769 S3-S4).
 */
@Module({
  imports: [PersonalizedFeedModule],
  providers: [
    RepRelevanceService,
    PersonalizedRepActivityService,
    PersonalizedRepsResolver,
  ],
  exports: [RepRelevanceService, PersonalizedRepActivityService],
})
export class PersonalizedRepsModule {}
