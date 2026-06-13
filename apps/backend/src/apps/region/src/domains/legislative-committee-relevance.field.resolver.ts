import { Injectable } from '@nestjs/common';
import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  type GqlContext,
  tryReadFederatedUserId,
} from 'src/common/utils/graphql-context';
import {
  LegislativeCommitteeDetailModel,
  LegislativeCommitteeModel,
} from './models/legislative-committee.model';

/**
 * Shared lookup for both field resolvers below. Reads
 * `committee_relevance_cache(userId, legislativeCommitteeId)` and returns
 * the LLM-written explanation or null. Bundled as a service so the two
 * field resolver classes (one per parent type) can share a single
 * implementation without duplicating bodies — the `@Resolver(() => Type)`
 * decorator binds at compile time and prevents trivial inheritance.
 */
@Injectable()
export class CommitteeRelevanceCacheLookup {
  constructor(private readonly db: DbService) {}

  async lookup(
    userId: string,
    legislativeCommitteeId: string,
  ): Promise<string | null> {
    const cacheRow = await this.db.committeeRelevanceCache.findUnique({
      where: {
        userId_legislativeCommitteeId: {
          userId,
          legislativeCommitteeId,
        },
      },
      select: { relevanceExplanation: true },
    });
    return cacheRow?.relevanceExplanation ?? null;
  }

  /**
   * Federation-safe variant for `@Public()` parent queries: extracts
   * the user id from the request context using the shared
   * `tryReadFederatedUserId` helper (which mirrors AuthGuard's
   * HMAC-then-user-header trust model) and returns `null` when no
   * authenticated user is in scope. The compact + detail field
   * resolvers both delegate here so the per-class body stays a single
   * line — see sonarjs no-identical-functions concerning the prior
   * inline implementations.
   */
  async lookupForRequest(
    context: GqlContext,
    legislativeCommitteeId: string,
  ): Promise<string | null> {
    const userId = tryReadFederatedUserId(context);
    if (!userId) return null;
    return this.lookup(userId, legislativeCommitteeId);
  }
}

/**
 * Field resolver for `LegislativeCommitteeModel.relevanceExplanation`
 * (opuspopuli#836). Reads from `committee_relevance_cache` and returns
 * the LLM-written sentence, or null when the nightly batch hasn't seen
 * this (user, committee) pair yet OR the LLM declined / validator
 * rejected.
 *
 * **Privacy contract enforcement:** the WRITER side
 * (`LlmRerankService.rerankCommitteesForUser`) intersects committee
 * members with the user's resolved rep slate before the LLM call. The
 * read side here trusts whatever the writer cached — by the time a row
 * lands in the cache, the contract has already been enforced upstream.
 * See prompt-service#81 + opuspopuli#836's acceptance criteria.
 *
 * **N+1 note:** one cache lookup per committee per request. Acceptable
 * for briefing surfaces (small lists). DataLoader is a follow-up if a
 * list page surfaces N > 20 committees with this field.
 */
@Resolver(() => LegislativeCommitteeModel)
export class LegislativeCommitteeRelevanceFieldResolver {
  constructor(private readonly cache: CommitteeRelevanceCacheLookup) {}

  @ResolveField('relevanceExplanation', () => String, { nullable: true })
  async resolveRelevanceExplanation(
    @Parent() committee: LegislativeCommitteeModel,
    @Context() context: GqlContext,
  ): Promise<string | null> {
    return this.cache.lookupForRequest(context, committee.id);
  }
}

/**
 * Field resolver for the detail variant. Delegates to the same shared
 * lookup service as the compact `LegislativeCommitteeRelevanceFieldResolver`.
 */
@Resolver(() => LegislativeCommitteeDetailModel)
export class LegislativeCommitteeDetailRelevanceFieldResolver {
  constructor(private readonly cache: CommitteeRelevanceCacheLookup) {}

  @ResolveField('relevanceExplanation', () => String, { nullable: true })
  async resolveRelevanceExplanation(
    @Parent() committee: LegislativeCommitteeDetailModel,
    @Context() context: GqlContext,
  ): Promise<string | null> {
    return this.cache.lookupForRequest(context, committee.id);
  }
}
