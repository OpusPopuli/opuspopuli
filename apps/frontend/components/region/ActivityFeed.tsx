"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_REP_ACTIVITY,
  type LegislativeAction,
  type PaginatedLegislativeActions,
} from "@/lib/graphql/region";
import { ActionCard } from "./ActionCard";

const PAGE_SIZE = 10;

interface Data {
  representativeActivity: PaginatedLegislativeActions;
}

interface Vars {
  id: string;
  actionTypes?: string[];
  includePresenceYes?: boolean;
  skip?: number;
  take?: number;
}

/**
 * Reverse-chronological feed of LegislativeActions linked to a
 * representative. Defaults to filtering out `presence:yes` (the
 * highest-volume / lowest-signal entries — the attendance counter
 * already summarizes them); a toggle reveals them when the user
 * wants the full record.
 *
 * Pagination: first 10, "Load more" pulls 10 at a time.
 *
 * Issue #665.
 */
export function ActivityFeed({
  representativeId,
  onSeePassage,
}: {
  readonly representativeId: string;
  readonly onSeePassage?: (actionId: string) => void;
}) {
  const [includePresenceYes, setIncludePresenceYes] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const { data, loading, error } = useQuery<Data, Vars>(GET_REP_ACTIVITY, {
    variables: {
      id: representativeId,
      includePresenceYes,
      skip: 0,
      take: pageSize,
    },
    notifyOnNetworkStatusChange: true,
  });

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={`feed-skeleton-${i.toString()}`}
            className="h-24 rounded-lg bg-slate-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Couldn&apos;t load recent activity. Try refreshing.
      </p>
    );
  }

  // Defensive optional chaining at every level — the test environment
  // uses a single global useQuery mock that returns the rep payload
  // for every query, so `data` may be present but `representativeActivity`
  // missing. Real queries always return the full shape.
  const items: LegislativeAction[] = data?.representativeActivity?.items ?? [];
  const total = data?.representativeActivity?.total ?? 0;
  const hasMore = data?.representativeActivity?.hasMore ?? false;

  if (total === 0) {
    return (
      <p className="italic text-slate-400 text-sm">
        No recorded activity in the last 90 days.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#595959]">
          Showing {items.length} of {total} record{total === 1 ? "" : "s"}
        </p>
        <label className="inline-flex items-center gap-2 text-xs text-[#595959] cursor-pointer">
          <input
            type="checkbox"
            checked={includePresenceYes}
            onChange={(e) => {
              setIncludePresenceYes(e.target.checked);
              setPageSize(PAGE_SIZE);
            }}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Include rollcall presence
        </label>
      </div>

      <ul className="space-y-3">
        {items.map((action) => (
          <li key={action.id}>
            <ActionCard action={action} onSeePassage={onSeePassage} />
          </li>
        ))}
      </ul>

      {hasMore && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setPageSize((p) => p + PAGE_SIZE)}
            disabled={loading}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
