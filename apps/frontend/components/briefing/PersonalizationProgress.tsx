"use client";

import { useEffect, useRef, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_RECENT_LLM_RERANK_JOBS,
  type MyRecentLlmRerankJobsData,
} from "@/lib/graphql/personalized-feed";

/**
 * How long we keep watching a run before assuming it is no longer ours to
 * report on. Generously past the observed worst case (~7.5 minutes for the
 * representative pass) so a slow-but-healthy run is never declared finished
 * while it is still writing.
 */
const RUN_WINDOW_MS = 20 * 60 * 1000;

/** Poll cadence while work is outstanding. Off entirely once nothing is. */
const POLL_MS = 15_000;

/**
 * Jobs still to finish.
 *
 * Compared case-INSENSITIVELY. The GraphQL enum serialises uppercase
 * (`QUEUED`, `RUNNING`, `SUCCEEDED`) while the database column stores
 * lowercase, and matching the database spelling meant `pending` was always
 * zero — so this notice rendered nothing at all on its first outing, while
 * the jobs it was reporting on ran perfectly.
 */
const PENDING = new Set(["queued", "running"]);

const isPending = (status: string | null | undefined): boolean =>
  PENDING.has((status ?? "").toLowerCase());

/**
 * "We're building your briefing" notice.
 *
 * A new user finishes onboarding, lands here, and their personalized sections
 * are empty — the explanations are generated per user by background jobs that
 * take several minutes. Without this, that reads as a broken or pointless
 * product on the one visit that forms an impression.
 *
 * Driven by ACTUAL job status rather than a timer: it polls the same
 * lifecycle rows the worker writes, so it disappears when the work really
 * finishes rather than when a countdown says it should. A timer would be
 * simpler and would lie in both directions — clearing early on a slow run,
 * lingering after a fast one.
 *
 * Renders nothing when there is no recent run, so returning users never see
 * it.
 */
export function PersonalizationProgress() {
  const { t } = useTranslation("briefing");

  const [mountedAt] = useState(() => Date.now());
  const client = useApolloClient();

  const { data, stopPolling } = useQuery<MyRecentLlmRerankJobsData>(
    GET_MY_RECENT_LLM_RERANK_JOBS,
    {
      variables: { limit: 8 },
      fetchPolicy: "network-only",
      // Polling is STOPPED explicitly once nothing is pending (see the effect
      // below). Without that this issues a network request every 15s for as
      // long as the tab is open, for every user including returning ones with
      // no active run -- a permanent background load on a platform that
      // already fires ~21 requests per briefing load and rate-limits per IP.
      pollInterval: POLL_MS,
      // A failure here must not surface: this is a progress hint, and an
      // error toast about background jobs is worse than silence.
      errorPolicy: "ignore",
    },
  );

  const jobs = data?.myRecentLlmRerankJobs ?? [];

  // `Date.now()` is impure, so it cannot be called during render. Captured
  // once on mount instead, which is also the behaviour we want: the window is
  // anchored to when the user arrived, not to each re-render.
  const cutoff = mountedAt - RUN_WINDOW_MS;
  const recent = jobs.filter((j) => {
    const at = Date.parse(j.enqueuedAt ?? "");
    return Number.isFinite(at) && at >= cutoff;
  });

  const pending = recent.filter((j) => isPending(j.status)).length;

  // Pull the freshly-generated content in when the run finishes.
  //
  // The sections are `cache-and-network`, so a manual reload would pick the
  // new explanations up -- but nobody should have to know that. Without this
  // the notice disappears and the sections stay exactly as empty as before,
  // which reads as the personalization having done nothing.
  //
  // Fires only on the pending -> 0 TRANSITION, never on mount, so a returning
  // user with no active run does not trigger a refetch storm.
  const previousPending = useRef<number | null>(null);
  useEffect(() => {
    const was = previousPending.current;
    previousPending.current = pending;

    // Nothing outstanding: stop asking. One request on mount settles whether
    // there is a run to watch; after that a returning user costs nothing.
    if (pending === 0) stopPolling();
    if (was !== null && was > 0 && pending === 0) {
      // Errors are swallowed rather than voided: a failed refetch just leaves
      // the already-correct cache-and-network sections to update on the next
      // navigation or reload.
      client.refetchQueries({ include: "active" }).catch(() => {});
    }
  }, [pending, client, stopPolling]);

  if (recent.length === 0 || pending === 0) return null;

  const done = recent.length - pending;

  return (
    <div
      className="rounded-lg border border-dashed border-line bg-surface-alt p-4 mb-6"
      // Progress that updates while the page is open — announce politely
      // rather than interrupting whatever the user is reading.
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-content">
        {t("personalizing.title")}
      </p>
      <p className="text-sm text-content-dim mt-1">{t("personalizing.body")}</p>
      <p className="text-sm text-content-dim mt-2" translate="no">
        {t("personalizing.progress", { done, total: recent.length })}
      </p>
    </div>
  );
}
