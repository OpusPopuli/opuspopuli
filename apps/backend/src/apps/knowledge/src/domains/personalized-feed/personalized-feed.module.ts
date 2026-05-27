import { Module } from '@nestjs/common';

import { ScoringService } from './scoring.service';
import { PersonalizedFeedService } from './personalized-feed.service';
import { PersonalizedFeedResolver } from './personalized-feed.resolver';

/**
 * Personalized bill feed (#743). v1.0 = tag-overlap scoring against
 * the bill-analysis controlled vocabularies; embeddings deferred to
 * Slice 2. Reads bills directly from the shared DB via DbService —
 * documented cross-service shortcut for MVP time pressure.
 */
@Module({
  providers: [
    ScoringService,
    PersonalizedFeedService,
    PersonalizedFeedResolver,
  ],
  exports: [PersonalizedFeedService, ScoringService],
})
export class PersonalizedFeedModule {}
