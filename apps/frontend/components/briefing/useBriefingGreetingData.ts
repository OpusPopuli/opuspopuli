"use client";

import { useQuery } from "@apollo/client/react";
import {
  GET_BRIEFING_PREFETCH,
  type BriefingPrefetchData,
} from "@/lib/graphql/personalized-feed";
import { useBillBriefing } from "./bills/useBillBriefing";
import { useRepsBriefing } from "./reps/useRepsBriefing";
import { useCommitteesBriefing } from "./committees/useCommitteesBriefing";
import { usePropositionsBriefing } from "./propositions/usePropositionsBriefing";
import type { BriefingCounts } from "./BriefingGreeting";

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

  return {
    firstName: firstName && firstName.length > 0 ? firstName : null,
    counts,
    urgentBillCount,
    loading,
  };
}
