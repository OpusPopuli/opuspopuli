import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';
import { RankingFlagsInputDto } from '../../personalized-feed/dto/personalization-input.dto';

/**
 * Bundled input for `myPersonalizedPropositionFeed` (#771). Same shape
 * as `PersonalizationInputDto` (bills, #743) — the frontend pre-fetches
 * `myRankingFlags` + `mySignalProfile { interestTags }` from the users
 * service in one query, then passes them here so this resolver can do
 * the ranking without making a cross-service call back to users.
 *
 * `trustedOrganizations` is intentionally NOT on this DTO for Phase 1
 * of #771 — endorsement chips ship in the Phase 2 follow-up that also
 * needs a backing `PropositionEndorsement` data model. Adding it to
 * the DTO before the data is real would let the frontend send signals
 * the ranker can't yet honor.
 */
@InputType()
export class PropositionPersonalizationInputDto {
  /** User's declared topic interests (housing, healthcare, etc.) */
  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  interestTags!: string[];

  /** Derived boolean flags from the users service (re-uses bills DTO). */
  @Field(() => RankingFlagsInputDto)
  @ValidateNested()
  @Type(() => RankingFlagsInputDto)
  flags!: RankingFlagsInputDto;
}
