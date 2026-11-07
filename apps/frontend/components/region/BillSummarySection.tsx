"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  GET_BILL_SUMMARY_STATUS,
  REQUEST_BILL_SUMMARY,
  type BillSummaryStatus,
  type BillSummaryStatusData,
  type BillIdVars,
  type RequestBillSummaryData,
  type RequestBillSummaryVars,
} from "@/lib/graphql/region";

/**
 * A summary takes from seconds to a couple of minutes on the GPU. Poll the
 * light status query, and stop promising one after a bounded wait.
 */
const POLL_MS = 15_000;
const POLL_LIMIT = 8;

interface BillSummarySectionProps {
  readonly billId: string;
  /** The status `GET_BILL` returned; absent on an older server. */
  readonly status?: BillSummaryStatus;
  readonly hasSummary: boolean;
  /** The summary itself, when there is one to show. */
  readonly children?: ReactNode;
}

const canRequest = (status?: BillSummaryStatus) =>
  status === "MISSING" || status === "STALE";

/**
 * A bill's plain-English summary, and getting one when it is missing or out
 * of date (`bills-phase-b.md` D7, `ingestion-resource-lanes.md` §5.2).
 *
 * A signed-in reader's page asks for it automatically; an anonymous reader
 * gets a button, so a person — not a page load or a crawler — starts
 * generation. The source facts below never wait on it. Every state is
 * announced from one persistent `aria-live` region.
 */
export function BillSummarySection({
  billId,
  status,
  hasSummary,
  children,
}: BillSummarySectionProps) {
  const { t } = useTranslation("region");
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const client = useApolloClient();
  const statusRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState<BillSummaryStatus | undefined>();
  const [request, { loading: requesting }] = useMutation<
    RequestBillSummaryData,
    RequestBillSummaryVars
  >(REQUEST_BILL_SUMMARY);

  const ask = useCallback(async () => {
    let answer: BillSummaryStatus;
    try {
      const { data } = await request({ variables: { billId } });
      answer = data?.requestBillSummary ?? "UNAVAILABLE";
    } catch {
      answer = "UNAVAILABLE";
    }
    setRequested(answer);
    // The batch wrote it after this page loaded: fetch it once, so the page
    // shows it rather than saying there is none.
    if (answer === "CURRENT" && !hasSummary) {
      await client
        .query({
          query: GET_BILL_SUMMARY_STATUS,
          variables: { id: billId },
          fetchPolicy: "network-only",
        })
        .catch(() => undefined);
    }
  }, [billId, request, client, hasSummary]);

  /** The button disappears once pressed; focus goes to what replaced it. */
  const askFromButton = useCallback(async () => {
    await ask();
    statusRef.current?.focus();
  }, [ask]);

  // Signed in: ask once, as the page opens.
  const asked = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect -- the request is the
     effect: a signed-in reader's page starts it once, and its reply sets the
     status. A ref keeps it to one request per page. */
  useEffect(() => {
    if (authLoading || !isAuthenticated || asked.current) return;
    if (!canRequest(status)) return;
    asked.current = true;
    void ask();
  }, [authLoading, isAuthenticated, status, ask]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const waiting = (requested ?? status) === "PENDING";
  const [stoppedPolling, setStoppedPolling] = useState(false);
  const { data: polled } = useQuery<BillSummaryStatusData, BillIdVars>(
    GET_BILL_SUMMARY_STATUS,
    {
      variables: { id: billId },
      skip: !waiting,
      fetchPolicy: "network-only",
      pollInterval: waiting && !stoppedPolling ? POLL_MS : 0,
    },
  );
  const polledStatus = polled?.billSummaryStatus;
  const effective: BillSummaryStatus | undefined =
    waiting && polledStatus ? polledStatus : (requested ?? status);
  const pending = effective === "PENDING";

  // Settle on what the poll found, so the poll stops once it lands.
  /* eslint-disable react-hooks/set-state-in-effect -- the poll's answer ends
     the wait; held only in query data, `waiting` would stay true (and the
     page keep polling) for as long as the tab is open. */
  useEffect(() => {
    // Only a poll that ran counts: a skipped query can still hold old data.
    if (waiting && polledStatus && polledStatus !== "PENDING") {
      setRequested(polledStatus);
    }
  }, [waiting, polledStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A ceiling, so a summary that never lands does not poll for as long as
  // the tab is open.
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(
      () => setStoppedPolling(true),
      POLL_MS * POLL_LIMIT,
    );
    return () => window.clearTimeout(id);
  }, [pending]);

  const message = statusMessage(effective, {
    hasSummary,
    gaveUp: pending && stoppedPolling,
    signedIn: isAuthenticated,
  });
  const showButton =
    !isAuthenticated && !authLoading && !requested && canRequest(effective);

  return (
    <div className="mb-6">
      {children}
      <div
        ref={statusRef}
        tabIndex={-1}
        aria-live="polite"
        role="status"
        className={
          message
            ? "mt-2 text-sm text-content-dim focus:outline-none"
            : "sr-only"
        }
      >
        {message && (
          <p className="flex items-center gap-2">
            {pending && !stoppedPolling && (
              <LoadingSpinner size="sm" className="text-accent" />
            )}
            <span>{t(message)}</span>
          </p>
        )}
      </div>
      {showButton && (
        <button
          type="button"
          onClick={() => void askFromButton()}
          disabled={requesting}
          className="mt-3 rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {t(
            effective === "STALE"
              ? "bill.summary.updateButton"
              : "bill.summary.requestButton",
          )}
        </button>
      )}
    </div>
  );
}

/** The i18n key for what to tell the reader, or none. */
function statusMessage(
  status: BillSummaryStatus | undefined,
  ctx: { hasSummary: boolean; gaveUp: boolean; signedIn: boolean },
): string | undefined {
  switch (status) {
    case "PENDING":
      return ctx.gaveUp ? "bill.summary.slow" : "bill.summary.preparing";
    case "UNAVAILABLE":
      return "bill.summary.unavailable";
    case "STALE":
      return ctx.signedIn ? undefined : "bill.summary.stale";
    case "MISSING":
      return ctx.signedIn ? "bill.summary.preparing" : "bill.summary.missing";
    case "CURRENT":
      return ctx.hasSummary ? undefined : "bill.summary.none";
    default:
      return ctx.hasSummary ? undefined : "bill.summary.missing";
  }
}
