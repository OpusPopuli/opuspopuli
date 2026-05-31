import { UseGuards } from '@nestjs/common';
import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import {
  type GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { PropositionPersonalizationInputDto } from './dto/proposition-personalization-input.dto';
import { PersonalizedPropositionResultModel } from './models/personalized-proposition-result.model';
import {
  PersonalizedPropositionsService,
  PROPOSITION_FEED_DEFAULT_LIMIT,
} from './personalized-propositions.service';

/**
 * v1.0 personalized propositions feed (#771). Mirrors the bill-feed
 * resolver shape so the frontend pre-fetches `myRankingFlags` +
 * `mySignalProfile { interestTags }` once and passes them as input
 * here — no cross-service hop back to users on every briefing render.
 *
 * Phase 1 ships heuristic scoring only (axes 1-3 in
 * `PropositionScoringService`). No mutation surface in this resolver
 * yet — the LLM rerank flow that lives on the bill feed (#745) is a
 * Phase 2 candidate for propositions.
 *
 * Limit defaults to 5 (briefing surface sweet spot) and is hard-capped
 * at 10 inside the service — beyond that the briefing card becomes a
 * list view, which `/region/propositions` already covers.
 */
@Resolver()
@UseGuards(AuthGuard)
export class PersonalizedPropositionsResolver {
  constructor(private readonly feed: PersonalizedPropositionsService) {}

  @Query(() => [PersonalizedPropositionResultModel], {
    name: 'myPersonalizedPropositionFeed',
  })
  async getMyPersonalizedPropositionFeed(
    @Args('input') input: PropositionPersonalizationInputDto,
    @Args('limit', { type: () => Int, nullable: true })
    limit: number | undefined,
    @Context() context: GqlContext,
  ): Promise<PersonalizedPropositionResultModel[]> {
    const user = getUserFromContext(context);
    return this.feed.getFeedForUser(
      user.id,
      input,
      limit ?? PROPOSITION_FEED_DEFAULT_LIMIT,
    );
  }
}
