"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

export interface BriefingCounts {
  readonly bills: number;
  readonly reps: number;
  readonly committees: number;
  readonly propositions: number;
}

export interface BriefingGreetingProps {
  /**
   * User's first name from `myProfile.firstName`. Null when the user
   * hasn't shared a name — the greeting drops to the no-name branch.
   */
  readonly firstName?: string | null;
  readonly counts: BriefingCounts;
  /**
   * Number of bills with an actionability signal urgent enough to
   * surface as a callout (vote/comment window within 30 days). Derived
   * by the parent from the bill feed's `contributingSignals`. Zero
   * suppresses the urgency line; the greeting falls through to the
   * neutral summary.
   */
  readonly urgentBillCount?: number;
  /**
   * Override for testing — when omitted the component reads the local
   * clock for the time-of-day greeting selection. Tests inject a fixed
   * hour so the assertions don't depend on wall-clock time.
   */
  readonly nowHour?: number;
}

/**
 * Personalized briefing greeting (#849 Phase 1, deterministic template).
 *
 * Anchors trust at the top of `/me/briefing` by:
 *   - addressing the user by their first name when available,
 *   - acknowledging time of day so the page feels alive,
 *   - summarizing what's below the fold (count + the most urgent item),
 *   - keeping copy strictly descriptive — never persuasive ("here's
 *     what's below", never "you should care about X"). Commitment 4
 *     ("we will never use your information to target you politically")
 *     is enforced at the i18n catalog: all greeting strings are
 *     hand-authored and reviewed; nothing is generated at render time.
 *
 * No-name branch uses different copy per language for inclusion
 * reasons:
 *   - EN: "Hello, neighbor" — civic in spirit, no legal-status claim
 *     ("citizen" excludes permanent residents, DACA, asylum-seeking,
 *     undocumented users — see §10 commitment 8 + planning doc §4.4
 *     immigration concern).
 *   - ES: no address-word — Spanish "vecino/vecina" is gendered and
 *     we don't ask T1/T2 for gender. The time-of-day phrase
 *     ("Buenos días", "Buenas tardes", "Buenas noches") carries the
 *     greeting alone.
 *
 * Phase 2 (#849 follow-up) will swap the summary sentence for an
 * LLM-polished version with activity context — this component stays
 * as the always-on fallback when the LLM field is null / validator
 * rejected / cache miss. The template surface here MUST keep working
 * standalone.
 */
export function BriefingGreeting({
  firstName,
  counts,
  urgentBillCount = 0,
  nowHour,
}: BriefingGreetingProps) {
  const { t, i18n } = useTranslation("briefing");
  const trimmedName = firstName?.trim() || null;
  const hour = nowHour ?? new Date().getHours();
  const timeKey = pickTimeOfDayKey(hour);
  const isSpanish = i18n.language.startsWith("es");

  const greetingLine = renderGreeting({
    timeKey,
    firstName: trimmedName,
    isSpanish,
    t,
  });
  const summaryLine = t("greeting.summary", {
    billCount: counts.bills,
    repCount: counts.reps,
    committeeCount: counts.committees,
    propositionCount: counts.propositions,
  });
  const urgentLine =
    urgentBillCount > 0
      ? t("greeting.urgentCallout", { count: urgentBillCount })
      : null;

  return (
    <section
      aria-labelledby="briefing-greeting-heading"
      data-testid="briefing-greeting"
      className="rounded-2xl border border-sage-200 dark:border-sage-700 bg-sage-50/60 dark:bg-sage-900/20 px-5 py-5 sm:px-6 sm:py-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1
            id="briefing-greeting-heading"
            className="text-2xl sm:text-3xl font-bold text-[#2D4A3C] dark:text-sage-100"
          >
            {greetingLine}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-[#4d4d4d] dark:text-gray-300">
            {summaryLine}
          </p>
          {urgentLine && (
            <p className="mt-1 text-sm sm:text-base font-medium text-[#5A7A6A] dark:text-sage-200">
              {urgentLine}
            </p>
          )}
        </div>
        <Link
          href="/region"
          aria-label={t("page.browseAllAria")}
          className="text-sm font-medium text-[#5A7A6A] hover:text-[#2D4A3C] dark:text-sage-200 dark:hover:text-white whitespace-nowrap shrink-0"
        >
          {t("page.browseAllLink")}
        </Link>
      </div>
    </section>
  );
}

type TimeOfDayKey = "morning" | "afternoon" | "evening";

/**
 * Bucket the hour-of-day into a greeting register. The boundaries
 * match common civic-comms convention (5am-noon / noon-6pm / 6pm-5am)
 * — slightly looser than "professional" thresholds because the page
 * is read at all hours and "Good evening" reads warmer at 5pm than
 * "Good afternoon" does at 7pm.
 */
function pickTimeOfDayKey(hour: number): TimeOfDayKey {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

interface RenderGreetingArgs {
  timeKey: TimeOfDayKey;
  firstName: string | null;
  isSpanish: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}

/**
 * Pick the right i18n key for the (timeKey, firstName, language)
 * combination. Spanish drops the address-word when no first name is
 * known (gender-agnostic time-of-day phrase carries it alone); English
 * uses "Hello, neighbor" / "Good morning, neighbor" / etc.
 */
function renderGreeting({
  timeKey,
  firstName,
  isSpanish,
  t,
}: RenderGreetingArgs): string {
  if (firstName) {
    return t(`greeting.named.${timeKey}`, { firstName });
  }
  if (isSpanish) {
    return t(`greeting.timeOnly.${timeKey}`);
  }
  return t(`greeting.neighbor.${timeKey}`);
}
