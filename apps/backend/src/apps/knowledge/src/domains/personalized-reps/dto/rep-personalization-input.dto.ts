import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  ValidateNested,
} from 'class-validator';
import { RankingFlagsInputDto } from '../../personalized-feed/dto/personalization-input.dto';

/**
 * Hard upper bound on the rep candidate set the orchestrator will
 * accept. The frontend already pre-resolves the user's reps via
 * `representativesByDistricts` + `countyRepresentatives` — a CA user
 * lands at ~5-12 reps (federal + state + county supervisor). 50 is
 * generous headroom against multi-jurisdiction users (e.g. a future
 * "districts crossing 3 states" power user) without exposing an
 * unbounded fanout to a malicious or buggy client.
 */
export const MAX_REPRESENTATIVE_IDS = 50;

/**
 * Bundled input for `myPersonalizedRepActivity` (#769). Same shape as
 * the bills (#743) and propositions (#771) inputs — frontend pre-fetches
 * `myRankingFlags` + `mySignalProfile { interestTags }` from the users
 * service in one query, then passes them here so this resolver can do
 * the ranking without a cross-service call back to users.
 *
 * Unlike bills + props (where the candidate set is global to the
 * region and the orchestrator queries it itself), reps are
 * user-specific: a SF resident's Assembly member is different from a
 * Sacramento resident's. The frontend already resolves the user's reps
 * via existing `representativesByDistricts` + `countyRepresentatives`
 * queries, so the cleanest contract is for the frontend to pass the
 * IDs here. Knowledge service stays stateless re user→rep mapping —
 * no cross-service call back to users or to region for jurisdiction
 * resolution.
 */
@InputType()
export class RepPersonalizationInputDto {
  /**
   * Representative IDs to score, resolved by the frontend via the
   * existing region subgraph queries. Bounded by `MAX_REPRESENTATIVE_IDS`
   * to cap orchestrator fanout.
   */
  @Field(() => [ID])
  @IsArray()
  @ArrayMaxSize(MAX_REPRESENTATIVE_IDS)
  @IsString({ each: true })
  representativeIds!: string[];

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
