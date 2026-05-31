"use client";

import { useEffect, useMemo, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client/react";
import { GET_BILL, type Bill, type BillData } from "@/lib/graphql/region";
import {
  GET_BRIEFING_PREFETCH,
  GET_MY_PERSONALIZED_BILL_FEED,
  stripTypename,
  type BriefingPrefetchData,
  type PersonalizationInput,
  type PersonalizedBillFeedData,
  type PersonalizedBillResult,
} from "@/lib/graphql/personalized-feed";

export interface RankedBill {
  readonly result: PersonalizedBillResult;
  readonly bill: Bill | null;
}

export interface BillBriefingState {
  readonly loading: boolean;
  readonly error: string | null;
  /** True before the prefetch resolves (rare beyond first paint). */
  readonly noProfile: boolean;
  /** True after prefetch + feed resolve but the feed is empty. */
  readonly empty: boolean;
  readonly topicTags: readonly string[];
  readonly rankedBills: readonly RankedBill[];
}

/**
 * Orchestrates the three-step bill-briefing fetch:
 *   1. `myRankingFlags` + `mySignalProfile { interestTags }`
 *   2. `myPersonalizedBillFeed(input, limit)` — chained, requires #1
 *   3. `bill(id)` for each returned billId — parallel; details come
 *      from the region service since the personalized-feed resolver
 *      returns only the ranking output (planning doc §6.3).
 *
 * v1.0 caveat: `bill(id)` runs N parallel requests. Apollo's
 * normalized cache dedupes per session, but the first-paint N
 * round-trips is what #761's batched/composite resolver eliminates.
 */
export function useBillBriefing(limit: number): BillBriefingState {
  const client = useApolloClient();

  const prefetch = useQuery<BriefingPrefetchData>(GET_BRIEFING_PREFETCH, {
    fetchPolicy: "cache-and-network",
  });

  const flags = prefetch.data?.myRankingFlags;
  const interestTags = prefetch.data?.mySignalProfile?.interestTags;
  const input: PersonalizationInput | null = useMemo(() => {
    if (!flags || !interestTags) return null;
    // Strip Apollo's auto-added `__typename` before passing the flags
    // back as a GraphQL InputType (RankingFlagsInputDto rejects the
    // extra field). The helper is unit-tested.
    return {
      flags: stripTypename(flags),
      interestTags: [...interestTags],
    };
  }, [flags, interestTags]);

  const feed = useQuery<PersonalizedBillFeedData>(
    GET_MY_PERSONALIZED_BILL_FEED,
    {
      variables: input ? { input, limit } : undefined,
      skip: !input,
      fetchPolicy: "cache-and-network",
    },
  );

  const feedResults = feed.data?.myPersonalizedBillFeed;

  const [bills, setBills] = useState<Map<string, Bill | null>>(new Map());
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsError, setBillsError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Bill details
     fan-out can't happen until the feed ids land, and Apollo
     doesn't expose a hook-friendly way to fetch N independent
     queries whose count is data-dependent. The effect launches an
     out-of-band fan-out and stores the result; standard pattern
     for "fetch N things on resolve, render when all settle". */
  useEffect(() => {
    if (!feedResults || feedResults.length === 0) return;
    let cancelled = false;
    setBillsLoading(true);
    setBillsError(null);

    Promise.all(
      feedResults.map((r) =>
        client
          .query<BillData>({
            query: GET_BILL,
            variables: { id: r.billId },
            fetchPolicy: "cache-first",
          })
          .then((res) => [r.billId, res.data?.bill ?? null] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setBills(new Map(entries));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBillsError(
          err instanceof Error ? err.message : "Failed to load bill details",
        );
      })
      .finally(() => {
        if (!cancelled) setBillsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedResults, client]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rankedBills: RankedBill[] = useMemo(
    () =>
      (feedResults ?? []).map((r) => ({
        result: r,
        bill: bills.get(r.billId) ?? null,
      })),
    [feedResults, bills],
  );

  // "No scoring inputs" guard — fires when prefetch resolved but the
  // user has declared neither interest tags NOR any TRUE rankingFlags.
  // Either one is sufficient for the ranker (axis 1 reads flags,
  // axis 2 reads tags), so the noProfile nudge only makes sense when
  // BOTH are empty. Kept in lockstep with the propositions hook.
  const hasAnyFlag = !!flags && Object.values(flags).some((v) => v === true);
  const hasAnyTag = !!interestTags && interestTags.length > 0;
  const noProfile = !prefetch.loading && !hasAnyFlag && !hasAnyTag;

  const queryError = prefetch.error ?? feed.error;
  const loading =
    prefetch.loading || feed.loading || (!!feedResults && billsLoading);
  const empty = !loading && (feedResults?.length ?? 0) === 0 && !noProfile;
  const error = queryError?.message ?? billsError ?? null;

  return {
    loading,
    error,
    noProfile,
    empty,
    topicTags: interestTags ?? [],
    rankedBills,
  };
}
