"use client";

import { useEffect, useMemo, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client/react";
import {
  GET_BILL_BRIEF,
  GET_REPRESENTATIVES_BY_DISTRICTS,
  MY_COUNTY_SUPERVISORS,
  type BillBrief,
  type BillBriefData,
  type MyCountySupervisorsData,
  type Representative,
  type RepresentativesByDistrictsData,
} from "@/lib/graphql/region";
import { GET_MY_ADDRESSES, type MyAddressesData } from "@/lib/graphql/profile";
import {
  GET_BRIEFING_PREFETCH,
  stripTypename,
  type BriefingPrefetchData,
} from "@/lib/graphql/personalized-feed";
import {
  GET_MY_PERSONALIZED_REP_ACTIVITY,
  type PersonalizedRepActivityData,
  type PersonalizedRepActivityResult,
  type RepPersonalizationInput,
} from "@/lib/graphql/personalized-reps";

export interface RankedRep {
  readonly result: PersonalizedRepActivityResult;
  readonly representative: Representative | null;
  readonly recentBills: readonly BillBrief[];
}

export interface RepsBriefingState {
  readonly loading: boolean;
  readonly error: string | null;
  /** True before the prefetch resolves OR when the user has no signals. */
  readonly noProfile: boolean;
  /**
   * True when neither the district nor the county query produced any
   * reps for the user — typically because no primary address has been
   * geocoded yet. CTA prompts the user to add an address.
   */
  readonly noDistricts: boolean;
  /** True after prefetch + feed resolve but the feed is empty. */
  readonly empty: boolean;
  readonly rankedReps: readonly RankedRep[];
}

/**
 * Orchestrates the rep-activity briefing fetch (#769):
 *   1. `myAddresses` → user's primary-address districts (no districts
 *      → render the noDistricts CTA).
 *   2. `representativesByDistricts(...)` → the user's state reps,
 *      AND `myCountySupervisors` → the user's county supervisor(s).
 *      Both queries run in parallel; their results are id-unioned.
 *      Matches the pattern at /region/representatives/page.tsx so
 *      county-level reps (often the most responsive local
 *      government) are scored alongside state-level reps.
 *   3. `myRankingFlags` + `mySignalProfile { interestTags }` — shared
 *      with the bills + props sections; Apollo's cache means it's free
 *      when multiple sections mount together.
 *   4. `myPersonalizedRepActivity(input)` → chained, requires #2 + #3.
 *   5. `bill(id)` for each `recentActivityBillIds` entry — parallel,
 *      lightweight projection via `GET_BILL_BRIEF` (just billNumber +
 *      title, not the full GET_BILL payload).
 *
 * Mirrors `usePropositionsBriefing` for the cache + state-machine
 * structure; the per-domain fetch differences are the address-driven
 * rep ID resolution at step 1-2 and the per-result bill brief fan-out
 * at step 5.
 *
 * Federation refactor at #761 would collapse the per-domain fan-outs
 * into a single subgraph hop — for now the cache + parallelism keeps
 * the perceived load time tight.
 */
export function useRepsBriefing(): RepsBriefingState {
  const client = useApolloClient();

  const addresses = useQuery<MyAddressesData>(GET_MY_ADDRESSES, {
    fetchPolicy: "cache-and-network",
  });
  const primary = addresses.data?.myAddresses?.find((a) => a.isPrimary);
  const districts = useMemo(
    () => ({
      congressionalDistrict: primary?.congressionalDistrict,
      stateSenatorialDistrict: primary?.stateSenatorialDistrict,
      stateAssemblyDistrict: primary?.stateAssemblyDistrict,
    }),
    [primary],
  );
  const hasDistricts =
    !!districts.congressionalDistrict ||
    !!districts.stateSenatorialDistrict ||
    !!districts.stateAssemblyDistrict;

  const repsQuery = useQuery<RepresentativesByDistrictsData>(
    GET_REPRESENTATIVES_BY_DISTRICTS,
    {
      variables: districts,
      skip: !hasDistricts,
      fetchPolicy: "cache-and-network",
    },
  );
  const repsByDistrict = useMemo(
    () => repsQuery.data?.representativesByDistricts ?? [],
    [repsQuery.data],
  );

  // County supervisors come from a separate query — `myCountySupervisors`
  // resolves the user's county server-side from their address, no
  // client-side variables needed. It can run in parallel with the
  // district query above; both feed into the same id-union below.
  const supervisorsQuery = useQuery<MyCountySupervisorsData>(
    MY_COUNTY_SUPERVISORS,
    {
      fetchPolicy: "cache-and-network",
    },
  );
  const countyReps = useMemo(
    () => supervisorsQuery.data?.myCountySupervisors ?? [],
    [supervisorsQuery.data],
  );

  // Union state + county reps by id. A rep should never appear in both
  // result sets (different chambers, different DB rows), but the
  // dedupe is defensive — same pattern as
  // /region/representatives/page.tsx's `myRepIds` Set construction.
  const allReps = useMemo(() => {
    const seen = new Set<string>();
    const out: Representative[] = [];
    for (const rep of [...repsByDistrict, ...countyReps]) {
      if (seen.has(rep.id)) continue;
      seen.add(rep.id);
      out.push(rep);
    }
    return out;
  }, [repsByDistrict, countyReps]);

  const prefetch = useQuery<BriefingPrefetchData>(GET_BRIEFING_PREFETCH, {
    fetchPolicy: "cache-and-network",
  });
  const flags = prefetch.data?.myRankingFlags;
  const interestTags = prefetch.data?.mySignalProfile?.interestTags;

  const input: RepPersonalizationInput | null = useMemo(() => {
    if (!flags || !interestTags || allReps.length === 0) return null;
    return {
      representativeIds: allReps.map((r) => r.id),
      flags: stripTypename(flags),
      interestTags: [...interestTags],
    };
  }, [flags, interestTags, allReps]);

  const feed = useQuery<PersonalizedRepActivityData>(
    GET_MY_PERSONALIZED_REP_ACTIVITY,
    {
      variables: input ? { input } : undefined,
      skip: !input,
      fetchPolicy: "cache-and-network",
    },
  );

  const feedResults = feed.data?.myPersonalizedRepActivity;

  const [billBriefs, setBillBriefs] = useState<Map<string, BillBrief | null>>(
    new Map(),
  );
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsError, setBillsError] = useState<string | null>(null);

  // Fan-out fetch of bill briefs once the feed lands. Same out-of-band
  // pattern as `useBillBriefing` / `usePropositionsBriefing` because
  // the fan-out count is data-dependent and Apollo doesn't have a
  // hook-friendly batch API for "N independent queries from a single
  // array of ids".
  /* eslint-disable react-hooks/set-state-in-effect -- See pattern note above. */
  useEffect(() => {
    if (!feedResults) return;
    const allBillIds = Array.from(
      new Set(feedResults.flatMap((r) => r.recentActivityBillIds)),
    );
    if (allBillIds.length === 0) {
      // Avoid a no-op state update (and a downstream re-render) when
      // the map is already empty. The effect fires on every
      // feedResults identity change, including the common case where
      // feedResults arrives empty.
      setBillBriefs((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    setBillsLoading(true);
    setBillsError(null);

    Promise.all(
      allBillIds.map((id) =>
        client
          .query<BillBriefData>({
            query: GET_BILL_BRIEF,
            variables: { id },
            fetchPolicy: "cache-first",
          })
          .then((res) => [id, res.data?.bill ?? null] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setBillBriefs(new Map(entries));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBillsError(
          err instanceof Error
            ? err.message
            : "Failed to load recent bill details",
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

  const repsById = useMemo(
    () => new Map(allReps.map((r) => [r.id, r])),
    [allReps],
  );

  const rankedReps: RankedRep[] = useMemo(
    () =>
      (feedResults ?? []).map((result) => ({
        result,
        representative: repsById.get(result.representativeId) ?? null,
        recentBills: result.recentActivityBillIds
          .map((id) => billBriefs.get(id) ?? null)
          .filter((b): b is BillBrief => b !== null),
      })),
    [feedResults, repsById, billBriefs],
  );

  const hasAnyFlag = !!flags && Object.values(flags).some((v) => v === true);
  const hasAnyTag = !!interestTags && interestTags.length > 0;
  const noProfile = !prefetch.loading && !hasAnyFlag && !hasAnyTag;
  // `noDistricts` only fires once both rep-resolution queries have
  // settled and produced an empty union — that way a county-only user
  // (county supervisor resolved but no state-district fields on their
  // address) still sees their cards without the misleading "add
  // address" CTA stacking on top of them.
  const noDistricts =
    !addresses.loading &&
    !repsQuery.loading &&
    !supervisorsQuery.loading &&
    allReps.length === 0 &&
    !addresses.error;

  const queryError =
    addresses.error ??
    repsQuery.error ??
    supervisorsQuery.error ??
    prefetch.error ??
    feed.error;
  const loading =
    addresses.loading ||
    repsQuery.loading ||
    supervisorsQuery.loading ||
    prefetch.loading ||
    feed.loading ||
    (!!feedResults && billsLoading);
  const empty =
    !loading && (feedResults?.length ?? 0) === 0 && !noProfile && !noDistricts;
  const error = queryError?.message ?? billsError ?? null;

  return {
    loading,
    error,
    noProfile,
    noDistricts,
    empty,
    rankedReps,
  };
}
