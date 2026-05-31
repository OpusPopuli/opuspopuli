"use client";

import { useEffect, useMemo, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client/react";
import {
  GET_PROPOSITION,
  type Proposition,
  type PropositionData,
} from "@/lib/graphql/region";
import {
  GET_BRIEFING_PREFETCH,
  stripTypename,
  type BriefingPrefetchData,
} from "@/lib/graphql/personalized-feed";
import {
  GET_MY_PERSONALIZED_PROPOSITION_FEED,
  type PersonalizedPropositionFeedData,
  type PersonalizedPropositionResult,
  type PropositionPersonalizationInput,
} from "@/lib/graphql/personalized-propositions";

export interface RankedProposition {
  readonly result: PersonalizedPropositionResult;
  readonly proposition: Proposition | null;
}

export interface PropositionsBriefingState {
  readonly loading: boolean;
  readonly error: string | null;
  /** True before the prefetch resolves (rare beyond first paint). */
  readonly noProfile: boolean;
  /** True after prefetch + feed resolve but the feed is empty. */
  readonly empty: boolean;
  readonly topicTags: readonly string[];
  readonly rankedPropositions: readonly RankedProposition[];
}

/**
 * Orchestrates the three-step propositions-briefing fetch (#771):
 *   1. `myRankingFlags` + `mySignalProfile { interestTags }` — shared
 *      with the bills section's prefetch query; Apollo's cache means
 *      this is free when both sections mount together.
 *   2. `myPersonalizedPropositionFeed(input, limit)` — chained,
 *      requires #1.
 *   3. `proposition(id)` for each returned propositionId — parallel;
 *      details come from the region service (planning doc §6.3).
 *
 * Mirrors `useBillBriefing` exactly so the briefing-card layer stays
 * consistent across sections. Federation refactor at #761 collapses
 * the per-domain fan-out into a single subgraph hop.
 */
export function usePropositionsBriefing(
  limit: number,
): PropositionsBriefingState {
  const client = useApolloClient();

  const prefetch = useQuery<BriefingPrefetchData>(GET_BRIEFING_PREFETCH, {
    fetchPolicy: "cache-and-network",
  });

  const flags = prefetch.data?.myRankingFlags;
  const interestTags = prefetch.data?.mySignalProfile?.interestTags;
  const input: PropositionPersonalizationInput | null = useMemo(() => {
    if (!flags || !interestTags) return null;
    // Strip Apollo's auto-added `__typename` before passing back as a
    // GraphQL InputType. Same pattern as `useBillBriefing`.
    return {
      flags: stripTypename(flags),
      interestTags: [...interestTags],
    };
  }, [flags, interestTags]);

  const feed = useQuery<PersonalizedPropositionFeedData>(
    GET_MY_PERSONALIZED_PROPOSITION_FEED,
    {
      variables: input ? { input, limit } : undefined,
      skip: !input,
      fetchPolicy: "cache-and-network",
    },
  );

  const feedResults = feed.data?.myPersonalizedPropositionFeed;

  const [propositions, setPropositions] = useState<
    Map<string, Proposition | null>
  >(new Map());
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsError, setPropsError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Proposition
     detail fan-out can't happen until the feed ids land, and Apollo
     doesn't expose a hook-friendly way to fetch N independent queries
     whose count is data-dependent. Same out-of-band pattern as
     useBillBriefing. */
  useEffect(() => {
    if (!feedResults || feedResults.length === 0) return;
    let cancelled = false;
    setPropsLoading(true);
    setPropsError(null);

    Promise.all(
      feedResults.map((r) =>
        client
          .query<PropositionData>({
            query: GET_PROPOSITION,
            variables: { id: r.propositionId },
            fetchPolicy: "cache-first",
          })
          .then(
            (res) => [r.propositionId, res.data?.proposition ?? null] as const,
          ),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setPropositions(new Map(entries));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPropsError(
          err instanceof Error
            ? err.message
            : "Failed to load proposition details",
        );
      })
      .finally(() => {
        if (!cancelled) setPropsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedResults, client]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rankedPropositions: RankedProposition[] = useMemo(
    () =>
      (feedResults ?? []).map((r) => ({
        result: r,
        proposition: propositions.get(r.propositionId) ?? null,
      })),
    [feedResults, propositions],
  );

  // "No scoring inputs" guard — fires when prefetch resolved but the
  // user has declared neither interest tags NOR any TRUE rankingFlags.
  // Either one is sufficient for the ranker to score (axis 1 reads
  // flags, axis 2 reads tags), so the noProfile nudge only makes
  // sense when BOTH are empty. Single empty-inputs branch shared with
  // the bills hook so the two stay in lockstep.
  const hasAnyFlag = !!flags && Object.values(flags).some((v) => v === true);
  const hasAnyTag = !!interestTags && interestTags.length > 0;
  const noProfile = !prefetch.loading && !hasAnyFlag && !hasAnyTag;

  const queryError = prefetch.error ?? feed.error;
  const loading =
    prefetch.loading || feed.loading || (!!feedResults && propsLoading);
  const empty = !loading && (feedResults?.length ?? 0) === 0 && !noProfile;
  const error = queryError?.message ?? propsError ?? null;

  return {
    loading,
    error,
    noProfile,
    empty,
    topicTags: interestTags ?? [],
    rankedPropositions,
  };
}
