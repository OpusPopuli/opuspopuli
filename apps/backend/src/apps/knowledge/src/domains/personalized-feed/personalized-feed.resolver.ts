import { UseGuards } from '@nestjs/common';
import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import {
  type GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { PersonalizationInputDto } from './dto/personalization-input.dto';
import { PersonalizedBillResultModel } from './models/personalized-bill-result.model';
import {
  FEED_DEFAULT_LIMIT,
  PersonalizedFeedService,
} from './personalized-feed.service';

/**
 * v1.0 personalized bill feed. Frontend pre-fetches
 * `myRankingFlags` + `mySignalProfile { interestTags }` from the users
 * service in one query, then passes them as input here. See planning
 * doc §6.3 for why the boundary is shaped this way.
 *
 * `limit` defaults to 5 (the planning-doc / civic-engagement-research
 * sweet spot for sustained attention) and is hard-capped at 20 — beyond
 * that this stops being a "personalized briefing" and becomes a list.
 *
 * Issue #743.
 */
@Resolver()
@UseGuards(AuthGuard)
export class PersonalizedFeedResolver {
  constructor(private readonly feed: PersonalizedFeedService) {}

  @Query(() => [PersonalizedBillResultModel], {
    name: 'myPersonalizedBillFeed',
  })
  async getMyPersonalizedBillFeed(
    @Args('input') input: PersonalizationInputDto,
    @Args('limit', { type: () => Int, nullable: true })
    limit: number | undefined,
    @Context() context: GqlContext,
  ): Promise<PersonalizedBillResultModel[]> {
    const user = getUserFromContext(context);
    return this.feed.getFeedForUser(
      user.id,
      input,
      limit ?? FEED_DEFAULT_LIMIT,
    );
  }
}
