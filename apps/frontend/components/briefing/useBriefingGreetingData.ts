"use client";

import { useTranslation } from "react-i18next";
import { useQuery } from "@apollo/client/react";
import {
  GET_BRIEFING_PREFETCH,
  GET_MY_BRIEFING_SUMMARY,
  type BriefingPrefetchData,
  type BriefingSummaryData,
  type BriefingSummaryVars,
} from "@/lib/graphql/personalized-feed";
import { useBillBriefing } from "./bills/useBillBriefing";
import { useRepsBriefing } from "./reps/useRepsBriefing";
import { useCommitteesBriefing } from "./committees/useCommitteesBriefing";
import { usePropositionsBriefing } from "./propositions/usePropositionsBriefing";
import type { BriefingCounts } from "./BriefingGreeting";
import { topAxisFor } from "@/lib/graphql/personalized-feed";

/**
 * Number of items each section requests by default. Pulled from the
 * existing section components so the greeting counts match what the
 * user will actually see below. Hard-coded today because the sections
 * themselves hard-code these — the alternative (centralizing) is a
 * bigger refactor than the greeting needs to motivate.
 */
const SECTION_FEED_LIMIT = 5;

export interface BriefingGreetingData {
  firstName: string | null;
  counts: BriefingCounts;
  urgentBillCount: number;
  /**
   * LLM-polished briefing-summary paragraph (#849 Phase 2). Null on
   * cache miss + any failure path (LLM down, validator rejection,
   * malformed JSON, `{ skip: true }`). When null, `BriefingGreeting`
   * silently falls back to the deterministic Phase 1 mission line.
   *
   * Trade-off note: the LLM call can take 5-15s on first paint, so we
   * intentionally render the Phase 1 template immediately and let the
   * LLM paragraph swap in when it resolves. The brief flash is the
   * lesser of two evils — an empty skeleton for ~10s reads as a broken
   * page, and the LLM line lands inside a known-good envelope so the
   * swap feels like enrichment rather than replacement.
   */
  llmSummary: string | null;
  /** True while any of the underlying section queries are still in flight. */
  loading: boolean;
}

/**
 * Composes the data the `BriefingGreeting` component needs into a
 * single read-friendly shape. Subscribes to the same hooks the
 * existing section components use — Apollo's normalized cache
 * deduplicates so this doesn't multiply the network traffic, it just
 * lets the greeting render the same counts the sections will.
 *
 * `urgentBillCount` is derived from each bill's `axisScores.actionability`
 * — the scorer returns 1.0 for bills with action within 30 days, 0.5
 * for 30–60 days, and 0 beyond that. We treat 0.5 as the threshold
 * (Phase 2 will swap to the precise `contributingSignals` actionability
 * entry once #750 lands). Counts answers the issue's AC: "callout for
 * the most urgent item — `{N} bills, including 1 with a vote in the
 * next 30 days`".
 */
const URGENT_ACTIONABILITY_THRESHOLD = 0.5;
export function useBriefingGreetingData(): BriefingGreetingData {
  const prefetch = useQuery<BriefingPrefetchData>(GET_BRIEFING_PREFETCH, {
    fetchPolicy: "cache-and-network",
  });

  const bills = useBillBriefing(SECTION_FEED_LIMIT);
  const reps = useRepsBriefing();
  const committees = useCommitteesBriefing();
  const propositions = usePropositionsBriefing(SECTION_FEED_LIMIT);

  const firstName = prefetch.data?.myProfile?.firstName?.trim() ?? null;

  const counts: BriefingCounts = {
    bills: bills.rankedBills.length,
    reps: reps.rankedReps.length,
    committees: committees.committees.length,
    propositions: propositions.rankedPropositions.length,
  };

  const urgentBillCount = bills.rankedBills.reduce((acc, item) => {
    const score = item.result.axisScores?.actionability ?? 0;
    return score >= URGENT_ACTIONABILITY_THRESHOLD ? acc + 1 : acc;
  }, 0);

  const loading =
    prefetch.loading || bills.loading || reps.loading || propositions.loading;

  // Compute the top-bill axis label for the LLM context. Falls through
  // to undefined when there's no top bill — the resolver treats that
  // as `none` and the LLM picks the "quiet field" branch.
  const topBill = bills.rankedBills[0];
  const topBillTopAxis = topBill ? topAxisFor(topBill.result.axisScores) : null;

  // Only run the briefing-summary query once the section data has
  // settled so the LLM gets the same counts the user will see. We
  // skip while still loading; on first paint the BriefingGreeting
  // renders the Phase 1 template, then the LLM line swaps in when
  // this query resolves. Apollo's `cache-and-network` policy keeps
  // the prior generated paragraph visible on revisits.
  const { i18n } = useTranslation("briefing");
  const language = i18n.language.startsWith("es") ? "es" : "en";
  const briefingSummaryQuery = useQuery<
    BriefingSummaryData,
    BriefingSummaryVars
  >(GET_MY_BRIEFING_SUMMARY, {
    variables: {
      language,
      billCount: counts.bills,
      repCount: counts.reps,
      committeeCount: counts.committees,
      propositionCount: counts.propositions,
      urgentBillCount,
      firstName: firstName ?? null,
      topBillTopAxis,
    },
    skip: loading,
    fetchPolicy: "cache-and-network",
  });
  const llmSummary = briefingSummaryQuery.data?.myBriefingSummary ?? null;

  return {
    firstName: firstName && firstName.length > 0 ? firstName : null,
    counts,
    urgentBillCount,
    llmSummary,
    loading,
  };
}
