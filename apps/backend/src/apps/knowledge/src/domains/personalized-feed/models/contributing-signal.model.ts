import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * Discriminator for which kind of user signal contributed to a bill's
 * relevance score (#750). The frontend uses `(type, key)` to look up
 * a plain-language i18n label so we can present a citizen-readable
 * "we recommended this because…" list without leaking the controlled-
 * vocab strings to the UI.
 *
 * - `FLAG` — a boolean RankingFlags entry derived from the user's
 *   T1/T2/T3 profile (`isRenter`, `isParent`, `isVeteran`, …). T3-
 *   derived flags are already masked to `false` by RankingFlagsService
 *   when no-fields-mode is on, so they cannot surface here.
 * - `INTEREST_TAG` — a value from the user's declared interest tags
 *   that intersected the bill's `aiSummary.topics` controlled vocab.
 *   `key` is the tag slug itself (e.g. "housing", "climate") — the
 *   frontend falls back to the raw slug when no i18n label exists
 *   so per-region tag taxonomies don't break the UI.
 * - `ACTIONABILITY` — a temporal/process signal that the bill has a
 *   near-term vote, hearing, or comment window (e.g.
 *   `within_30_days`).
 */
export enum SignalType {
  FLAG = 'flag',
  INTEREST_TAG = 'interest_tag',
  ACTIONABILITY = 'actionability',
}

registerEnumType(SignalType, {
  name: 'SignalType',
  description:
    'Discriminator for the source of a ContributingSignal. The frontend ' +
    'uses (type, key) to derive a plain-language i18n label.',
});

/**
 * The three v1.0 scoring axes from planning doc §5.1. Registered as a
 * GraphQL enum so consumers get the same exhaustive type they'd get
 * from a TS union — drops the "string typo" failure mode for any
 * downstream code that switches on the axis name.
 */
export enum AxisName {
  DIRECT_MATERIAL = 'directMaterial',
  VALUES_ALIGNMENT = 'valuesAlignment',
  ACTIONABILITY = 'actionability',
}

registerEnumType(AxisName, {
  name: 'AxisName',
  description:
    'Which scoring axis a ContributingSignal contributed to. Mirrors ' +
    'the keys on AxisScores for the three axes that emit signals today ' +
    '(axes 4-7 are placeholder zeroes in v1.0).',
});

/**
 * One reason a bill landed on the user's briefing (§10 commitment 5:
 * "We will tell you why"). Returned alongside `axisScores` so the
 * frontend can render both an LLM narrative (one sentence) AND a
 * structured signal list (bullet points) — the citizen sees the
 * narrative first, the auditor sees the structured list.
 *
 * Signals are populated by `ScoringService` as it computes each axis.
 * Order is axis-weighted-descending then by match strength; callers
 * SHOULD cap to top-N before sending to the wire when the bill matched
 * many signals (planning-doc §8.2 recommends N=5).
 */
@ObjectType('ContributingSignal')
export class ContributingSignalModel {
  @Field(() => SignalType)
  type!: SignalType;

  /**
   * Within-type identifier. For FLAG it's the RankingFlags key
   * (`isRenter`, `isParent`, …). For INTEREST_TAG it's the tag slug
   * (`housing`, `climate`). For ACTIONABILITY it's a bucketed tier
   * (`within_30_days`, `within_60_days`).
   */
  @Field()
  key!: string;

  /**
   * Which scoring axis this signal contributed to — lets the panel
   * group signals by axis if it wants ("Direct material: renter,
   * housing; Actionability: within 30 days").
   */
  @Field(() => AxisName)
  axis!: AxisName;

  /**
   * True when this signal was derived from T3 (sensitive) profile
   * fields — veteran status, immigration concern, health condition,
   * justice-system involvement, public health insurance, income, or
   * public-benefits receipt (planning doc §4 sensitivity tiers).
   *
   * Per issue #750 AC: "T3 signals appear in the panel only when
   * 'show me why' mode is enabled (post-MVP); otherwise contributing-
   * signal entries derived from T3 fields show a generic explanation."
   *
   * MVP-current behavior: the frontend `signalLabel` helper renders a
   * single neutral string (`whyThis.signals.sensitiveFlag`) when this
   * flag is true, so the panel never names which sensitive trait the
   * recommendation rested on — the user knows they shared sensitive
   * data, the panel just acknowledges it factored in.
   *
   * Post-MVP show-me-why mode flips this rendering on-demand without
   * any schema or scorer churn.
   *
   * INTEREST_TAG and ACTIONABILITY signals are always non-sensitive
   * (interest tags are user-declared topics; actionability is process
   * recency).
   */
  @Field()
  isSensitive!: boolean;
}
