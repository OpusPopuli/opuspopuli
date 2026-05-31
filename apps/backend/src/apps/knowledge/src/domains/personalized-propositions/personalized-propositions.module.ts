import { Module } from '@nestjs/common';

import { PropositionScoringService } from './proposition-scoring.service';
import { PersonalizedPropositionsService } from './personalized-propositions.service';
import { PersonalizedPropositionsResolver } from './personalized-propositions.resolver';

/**
 * Personalized propositions feed (#771).
 *
 * Phase 1: heuristic 3-axis scoring against the user's RankingFlags +
 * interestTags + the proposition's election date. Reads propositions
 * directly from the shared DB via DbService — documented cross-service
 * shortcut, mirrors the bill ranker (#743). Federation refactor at #761.
 *
 * Phase 2 follow-ups (not in this module yet):
 *   - LLM rerank for prop explanations (reuses llm-rerank-worker
 *     infra from #745 with a new prompt-service template)
 *   - PropositionEndorsement model + scoring axis 5 (trusted-org
 *     coalition signal) — gated on the endorsement-data pipeline
 */
@Module({
  providers: [
    PropositionScoringService,
    PersonalizedPropositionsService,
    PersonalizedPropositionsResolver,
  ],
  exports: [PersonalizedPropositionsService, PropositionScoringService],
})
export class PersonalizedPropositionsModule {}
