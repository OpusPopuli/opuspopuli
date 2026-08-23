import { Field, InputType, ObjectType } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Input for the "What this means to you" personalized-impact read (#1052).
 *
 * The client passes only the citizen's *declared* signals — this mirrors the
 * live personalization pattern (knowledge PersonalizationInputDto) rather than
 * a subgraph->subgraph fetch. Privacy boundary: interest-tag slugs, the names
 * of the RankingFlags that are TRUE, and a coarse caller-anonymized region
 * label only. Never raw addresses or sensitive T3 values.
 *
 * The size caps and slug patterns are abuse hardening, not decoration: every
 * value below is interpolated into an LLM prompt, so free-form strings mean
 * attacker-directed prompt content and per-call LLM cost, and every distinct
 * value set mints a distinct cache row (2026-08-22 review, B2).
 */
@InputType()
export class PersonalizedImpactInput {
  @Field()
  @IsString()
  documentId!: string;

  /** Declared interest-tag slugs (controlled vocab, e.g. "housing"). */
  @Field(() => [String])
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  // Underscores are part of the canonical vocabulary (public_safety,
  // voting_rights — see onboarding TopicsStep); hyphens cover future slugs.
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    each: true,
    message: 'interestTags must be lowercase controlled-vocab slugs',
  })
  interestTags!: string[];

  /**
   * Names of the RankingFlags that are TRUE for this user (e.g. "isRenter").
   * Declared/derived booleans only — the client sends just the TRUE names.
   */
  @Field(() => [String])
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Matches(/^[a-z][A-Za-z0-9]*$/, {
    each: true,
    message: 'rankingFlags must be camelCase flag names',
  })
  rankingFlags!: string[];

  /** Coarse, caller-anonymized region label (e.g. "94xxx"). Never a raw address. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, {
    message: 'regionLabel must be a coarse alphanumeric label',
  })
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

  /**
   * True when served from the per-user cache rather than freshly generated.
   * Safe to expose: the cache is scoped to the requesting user, so this
   * reveals nothing about anyone else's activity.
   */
  @Field()
  fromCache!: boolean;
}
