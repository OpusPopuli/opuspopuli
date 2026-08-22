import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * Input for the "What this means to you" personalized-impact read (#1052).
 *
 * The client passes only the citizen's *declared* signals — this mirrors the
 * live personalization pattern (knowledge PersonalizationInputDto) rather than
 * a subgraph->subgraph fetch. Privacy boundary: interest-tag slugs, the names
 * of the RankingFlags that are TRUE, and a coarse caller-anonymized region
 * label only. Never raw addresses or sensitive T3 values.
 */
@InputType()
export class PersonalizedImpactInput {
  @Field()
  @IsString()
  documentId!: string;

  /** Declared interest-tag slugs (controlled vocab). */
  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  interestTags!: string[];

  /**
   * Names of the RankingFlags that are TRUE for this user (e.g. "isRenter").
   * Declared/derived booleans only — the client sends just the TRUE names.
   */
  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  rankingFlags!: string[];

  /** Coarse, caller-anonymized region label (e.g. "94xxx"). Never a raw address. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  regionLabel?: string;
}

/**
 * The personalized "what this means to you" read that leads the scan results.
 * Null (not this type) is returned when there is nothing to personalize
 * against — no analysis, or no declared signals — so the UI falls back to the
 * generic analysis.
 */
@ObjectType()
export class PersonalizedImpact {
  /** Plain-language read of how the measure affects this citizen. */
  @Field()
  text!: string;

  @Field({ nullable: true })
  provider?: string;

  @Field({ nullable: true })
  model?: string;

  @Field({ nullable: true })
  promptVersion?: string;

  /** True when served from the per-profile cache rather than freshly generated. */
  @Field()
  fromCache!: boolean;
}
