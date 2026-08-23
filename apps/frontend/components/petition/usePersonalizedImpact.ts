"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useAuth } from "@/lib/auth-context";
import {
  GET_BRIEFING_PREFETCH,
  type BriefingPrefetchData,
} from "@/lib/graphql/personalized-feed";
import { GET_MY_ADDRESSES, type MyAddressesData } from "@/lib/graphql/profile";
import {
  PERSONALIZED_IMPACT,
  type PersonalizedImpactData,
  type PersonalizedImpactResult,
} from "@/lib/graphql/documents";

/**
 * Coarsen a postal code to the anonymized region label the backend
 * expects (e.g. "94110" -> "94xxx"). Only the first two digits survive —
 * the label must never identify a household. Non-numeric or short codes
 * yield undefined (the prompt simply omits the region line).
 */
export function coarseRegionLabel(
  postalCode?: string | null,
): string | undefined {
  const match = /^(\d{2})\d{3}/.exec(postalCode?.trim() ?? "");
  return match ? `${match[1]}xxx` : undefined;
}

/** Names of the TRUE ranking flags, minus Apollo's __typename. */
export function trueFlagNames(flags: object | null | undefined): string[] {
  if (!flags) return [];
  return Object.entries(flags as Record<string, unknown>)
    .filter(([key, value]) => key !== "__typename" && value === true)
    .map(([key]) => key);
}

/**
 * Backend slug contract for interest tags (PersonalizedImpactInput). The
 * users service stores tags leniently, so one legacy free-form tag must
 * not 400 the whole request and silently kill personalization — filter
 * instead of failing. Keep in lockstep with the DTO pattern.
 */
const TAG_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

export type PersonalizedImpactStatus =
  /** Not signed in — show the sign-in nudge where the read would sit. */
  | "anonymous"
  /** Auth restore, profile fetch, or generation in flight. */
  | "loading"
  /** A personalized read is available. */
  | "ready"
  /** Nothing to personalize (no profile / null result / failure) — render nothing, the generic analysis is the fallback. */
  | "absent";

export interface PersonalizedImpactState {
  readonly status: PersonalizedImpactStatus;
  readonly impact: PersonalizedImpactResult | null;
}

/**
 * Drives the "What this means to you" read that leads the scan results
 * (#1052). Mirrors the briefing pattern: the frontend pre-fetches the
 * declared signals (myRankingFlags + mySignalProfile.interestTags) and
 * passes them as mutation input — no subgraph-to-subgraph fetch. Only
 * declared signals and a coarsened region label ever leave the client.
 *
 * Personalization failure is deliberately silent in the UI (status
 * "absent"): per the plan, the feature only ever adds — the generic
 * analysis below is always the fallback. It is NOT silent in the console,
 * so a systematic failure (e.g. a validation regression) stays observable.
 */
export function usePersonalizedImpact(
  documentId: string | null,
  analysisComplete: boolean,
): PersonalizedImpactState {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const requestedFor = useRef<string | null>(null);
  const [impact, setImpact] = useState<PersonalizedImpactResult | null>(null);
  const [settled, setSettled] = useState(false);

  // A new document in the same mount starts a fresh cycle — never serve
  // the previous document's read while the new generation is in flight.
  // Render-time state adjustment (the React "derive from prop change"
  // pattern), not an effect, so no intermediate stale render escapes.
  // (requestedFor needs no reset: it stores the requested documentId, so a
  // new document misses the effect's equality guard on its own.)
  const [lastDocumentId, setLastDocumentId] = useState(documentId);
  if (documentId !== lastDocumentId) {
    setLastDocumentId(documentId);
    setImpact(null);
    setSettled(false);
  }

  // cache-and-network (matching useBillBriefing): with persisted Apollo
  // cache, cache-first would happily personalize from week-old declared
  // signals edited on another device and never revalidate.
  const prefetch = useQuery<BriefingPrefetchData>(GET_BRIEFING_PREFETCH, {
    skip: !isAuthenticated,
    fetchPolicy: "cache-and-network",
  });
  const addresses = useQuery<MyAddressesData>(GET_MY_ADDRESSES, {
    skip: !isAuthenticated,
    fetchPolicy: "cache-and-network",
  });

  const [generate] = useMutation<PersonalizedImpactData>(PERSONALIZED_IMPACT);

  const flags = prefetch.data?.myRankingFlags;
  const interestTags = prefetch.data?.mySignalProfile?.interestTags;

  const input = useMemo(() => {
    if (!documentId || prefetch.loading || addresses.loading) return null;
    const rankingFlags = trueFlagNames(flags);
    const tags = (interestTags ?? []).filter((tag) => TAG_SLUG.test(tag));
    if (tags.length === 0 && rankingFlags.length === 0) return null;
    const primary =
      addresses.data?.myAddresses?.find((a) => a.isPrimary) ??
      addresses.data?.myAddresses?.[0];
    return {
      documentId,
      interestTags: tags,
      rankingFlags,
      regionLabel: coarseRegionLabel(primary?.postalCode),
    };
  }, [
    documentId,
    prefetch.loading,
    addresses.loading,
    flags,
    interestTags,
    addresses.data,
  ]);

  useEffect(() => {
    if (!analysisComplete || !input || !isAuthenticated) return;
    if (requestedFor.current === input.documentId) return;
    requestedFor.current = input.documentId;

    generate({ variables: { input } })
      .then((res) => {
        setImpact(res.data?.personalizedImpact ?? null);
      })
      .catch((err) => {
        // UI falls back silently by design, but keep the failure
        // observable — a systematic error here would otherwise be
        // indistinguishable from "user has no profile".
        console.warn("Personalized impact failed:", err);
        setImpact(null);
      })
      .finally(() => setSettled(true));
  }, [analysisComplete, input, isAuthenticated, generate]);

  if (authLoading) return { status: "loading", impact: null };
  if (!isAuthenticated) return { status: "anonymous", impact: null };
  const profileResolved = !prefetch.loading && !addresses.loading;
  if (profileResolved && analysisComplete && documentId != null && !input) {
    return { status: "absent", impact: null };
  }
  if (!analysisComplete || !settled) return { status: "loading", impact: null };
  if (impact) return { status: "ready", impact };
  return { status: "absent", impact: null };
}
