import { UseGuards } from '@nestjs/common';
import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import {
  getUserFromContext,
  type GqlContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';
import {
  BriefingSummaryService,
  type BriefingSummaryContext,
} from './briefing-summary.service';

/**
 * Per-field count ceilings — mirror the prompt-service
 * `BriefingSummaryDto` validator caps (paired PR opuspopuli-prompts#84).
 * Passing values above these would just trigger a prompt-service 4xx
 * + a wasted RPC round-trip + a misleading `llm_failed` in telemetry;
 * clamping at the resolver makes the contract honest and the metrics
 * meaningful.
 */
const COUNT_CAPS = {
  bill: 200,
  rep: 50,
  committee: 50,
  proposition: 100,
  urgentBill: 200,
} as const;

/**
 * GraphQL resolver for the personalized briefing-summary paragraph
 * (#849 Phase 2). One query: `myBriefingSummary(...)`. Returns the
 * cached or freshly-generated LLM paragraph, or null on any failure —
 * the frontend's `BriefingGreeting` silently falls back to the Phase 1
 * deterministic template on null.
 *
 * Authoritative input is the authenticated user; the frontend passes
 * the counts + urgent count + top-axis label so the prompt has the
 * same context the user sees on the page. The service guards the
 * sensitivity tier — only T1 firstName + non-sensitive aggregates
 * cross the prompt-service boundary (planning doc §6.3).
 */
@Resolver()
@UseGuards(AuthGuard)
export class BriefingSummaryResolver {
  constructor(private readonly summaryService: BriefingSummaryService) {}

  @Query(() => String, {
    name: 'myBriefingSummary',
    nullable: true,
    description:
      "LLM-polished 2-3 sentence opening paragraph for the user's /me/briefing page (#849 Phase 2). Null on cache miss + LLM failure, LLM `{ skip: true }`, validator rejection, or any infrastructure error — the frontend falls back to the deterministic Phase 1 template uniformly on null.",
  })
  async myBriefingSummary(
    @Args('language') language: string,
    @Args('billCount') billCount: number,
    @Args('repCount') repCount: number,
    @Args('committeeCount') committeeCount: number,
    @Args('propositionCount') propositionCount: number,
    @Args('urgentBillCount') urgentBillCount: number,
    @Args('firstName', { type: () => String, nullable: true })
    firstName: string | null,
    @Args('topBillTopAxis', { type: () => String, nullable: true })
    topBillTopAxis: string | null,
    @Context() context: GqlContext,
  ): Promise<string | null> {
    const user = getUserFromContext(context);

    const ctx: BriefingSummaryContext = {
      // Defer to .startsWith('es') so 'es-MX' / 'es-ES' both pick the
      // Spanish register — strict equality would silently downgrade
      // locale-suffixed languages to English.
      language: language.startsWith('es') ? 'es' : 'en',
      firstName: firstName?.trim() || null,
      billCount: this.clampCount(billCount, COUNT_CAPS.bill),
      repCount: this.clampCount(repCount, COUNT_CAPS.rep),
      committeeCount: this.clampCount(committeeCount, COUNT_CAPS.committee),
      propositionCount: this.clampCount(
        propositionCount,
        COUNT_CAPS.proposition,
      ),
      urgentBillCount: this.clampCount(urgentBillCount, COUNT_CAPS.urgentBill),
      topBillTopAxis: this.coerceTopAxis(topBillTopAxis),
    };

    return this.summaryService.getOrGenerate(user.id, ctx);
  }

  /**
   * Defensive clamp on caller-supplied counts. The frontend derives
   * these from already-rendered briefing data so they should already
   * be small non-negative ints, but the resolver is the trust
   * boundary — pin each to a tight per-field ceiling so a hostile or
   * buggy client cannot inflate a count and force the LLM to invent a
   * giant paragraph or trip the validator's word-count gate. Caps
   * mirror the prompt-service DTO (BriefingSummaryDto in the private
   * prompt-service repo); when the DTO is tightened, mirror the
   * change here too.
   */
  private clampCount(value: number, max: number): number {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.floor(value);
    if (rounded < 0) return 0;
    if (rounded > max) return max;
    return rounded;
  }

  /**
   * Coerce the frontend-supplied axis label to the typed enum the
   * service expects. Unknown strings collapse to null so the prompt
   * gets "none" — same as the no-bills branch.
   */
  private coerceTopAxis(
    value: string | null,
  ): 'directMaterial' | 'valuesAlignment' | 'actionability' | null {
    if (
      value === 'directMaterial' ||
      value === 'valuesAlignment' ||
      value === 'actionability'
    ) {
      return value;
    }
    return null;
  }
}
