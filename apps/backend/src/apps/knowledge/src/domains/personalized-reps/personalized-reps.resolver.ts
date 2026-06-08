import { UseGuards } from '@nestjs/common';
import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import {
  type GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { RepPersonalizationInputDto } from './dto/rep-personalization-input.dto';
import { PersonalizedRepActivityResultModel } from './models/personalized-rep-activity-result.model';
import { PersonalizedRepActivityService } from './personalized-rep-activity.service';

/**
 * v1.0 personalized rep-activity briefing (#769). Frontend pre-fetches
 * `myRankingFlags` + `mySignalProfile { interestTags }` + the user's
 * reps (via existing `representativesByDistricts` /
 * `countyRepresentatives` region queries) and passes them as input —
 * no cross-service hop back to users or to region for jurisdiction
 * resolution on every briefing render.
 *
 * No `limit` arg by design: the frontend already chose the candidate
 * set by passing `representativeIds`, and the orchestrator returns
 * every above-zero scoring rep sorted by composite. The briefing card
 * surface slices to its visible top-N (typically 3) client-side. If
 * a future surface wants pagination, add a Connection-style return
 * type rather than a scalar `limit` arg — bills/props' `limit`
 * pattern doesn't carry over cleanly here.
 *
 * Phase 1 ships heuristic scoring only (axes 1-3 in
 * `RepRelevanceService`). The LLM rerank flow from the bill feed
 * (#745) is a Phase 2 candidate — reserved by the
 * `relevanceExplanation` field on the result model.
 */
@Resolver()
@UseGuards(AuthGuard)
export class PersonalizedRepsResolver {
  constructor(private readonly briefing: PersonalizedRepActivityService) {}

  @Query(() => [PersonalizedRepActivityResultModel], {
    name: 'myPersonalizedRepActivity',
  })
  async getMyPersonalizedRepActivity(
    @Args('input') input: RepPersonalizationInputDto,
    @Context() context: GqlContext,
  ): Promise<PersonalizedRepActivityResultModel[]> {
    const user = getUserFromContext(context);
    return this.briefing.getRepActivityForUser(user.id, input);
  }
}
