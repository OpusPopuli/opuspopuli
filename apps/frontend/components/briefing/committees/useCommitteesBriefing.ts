"use client";

import { useMemo } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_BRIEFING_COMMITTEES,
  type PersonalizedCommitteesBriefingData,
  type CommitteeBriefingItem,
} from "@/lib/graphql/personalized-committees";

/**
 * Page-size for the bulk committee query. CA Assembly carries ~80
 * standing committees + ~84 subcommittees today. 100 covers Assembly
 * cleanly; if Senate ingest lands, raise to 250 alongside the analogous
 * scheduler `COMMITTEE_CANDIDATE_FETCH_LIMIT` bump.
 */
const COMMITTEE_FETCH_LIMIT = 100;

/** How many committees to surface on the briefing card stack. */
const BRIEFING_TOP_N = 5;

export interface CommitteeBriefingResult {
  readonly committees: ReadonlyArray<CommitteeBriefingItem>;
  readonly totalAvailable: number;
  readonly loading: boolean;
  readonly errored: boolean;
}

/**
 * Briefing hook for the Committees section (opuspopuli#836 follow-up to
 * #770). Fetches committees in bulk + filters client-side to those with
 * a populated `relevanceExplanation` — meaning the nightly batch's LLM
 * produced a topical match worth surfacing for this user.
 *
 * Client-side filter (rather than a dedicated server-side query)
 * because the existing region query already exposes the committee
 * list + the new field resolver does the per-(user, committee) cache
 * lookup. Phase 2 candidate: a `myPersonalizedCommittees(input)` query
 * in the knowledge service that returns pre-ranked + pre-filtered
 * results — same shape as `myPersonalizedRepActivity` for reps.
 */
export function useCommitteesBriefing(): CommitteeBriefingResult {
  const { data, loading, error } = useQuery<PersonalizedCommitteesBriefingData>(
    GET_BRIEFING_COMMITTEES,
    {
      variables: { take: COMMITTEE_FETCH_LIMIT },
      fetchPolicy: "cache-and-network",
    },
  );

  const filtered = useMemo<ReadonlyArray<CommitteeBriefingItem>>(() => {
    const items = data?.legislativeCommittees?.items ?? [];
    return items
      .filter((c) => Boolean(c.relevanceExplanation))
      .slice(0, BRIEFING_TOP_N);
  }, [data?.legislativeCommittees?.items]);

  return {
    committees: filtered,
    totalAvailable: data?.legislativeCommittees?.total ?? 0,
    loading,
    errored: Boolean(error),
  };
}
