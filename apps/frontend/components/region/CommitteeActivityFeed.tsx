"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_COMMITTEE_ACTIVITY,
  type LegislativeAction,
  type PaginatedLegislativeActions,
} from "@/lib/graphql/region";
import { groupActionsByType, groupBillBatches } from "@/lib/format-action";
import { ActionCard } from "./ActionCard";
import { GroupedBillBatch } from "./GroupedBillBatch";

const PAGE_SIZE = 10;

interface Data {
  committeeActivity: PaginatedLegislativeActions;
}

interface Vars {
  committeeId: string;
  actionTypes?: string[];
  skip?: number;
  take?: number;
}

/**
 * Reverse-chronological feed of LegislativeActions linked to a
 * legislative committee — committee_hearing + committee_report +
 * amendment rows from minutes ingestion. Optional type-filter
 * dropdown lets the user narrow to just hearings, just reports,
 * etc. Mirrors `ActivityFeed` but scoped by committeeId. Issue #665.
 */
export function CommitteeActivityFeed({
  committeeId,
  onSeePassage,
}: {
  readonly committeeId: string;
  readonly onSeePassage?: (actionId: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const actionTypes = filter === "all" ? undefined : [filter];

  const { data, loading, error } = useQuery<Data, Vars>(
    GET_COMMITTEE_ACTIVITY,
    {
      variables: {
        committeeId,
        actionTypes,
        skip: 0,
        take: pageSize,
      },
      notifyOnNetworkStatusChange: true,
    },
  );

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={`cmt-feed-skel-${i.toString()}`}
            className="h-24 rounded-lg bg-slate-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Couldn&apos;t load committee activity. Try refreshing.
      </p>
    );
  }

  const items: LegislativeAction[] = data?.committeeActivity?.items ?? [];
  const total = data?.committeeActivity?.total ?? 0;
  const hasMore = data?.committeeActivity?.hasMore ?? false;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-xs text-[#595959]">
          Showing {items.length} of {total} record{total === 1 ? "" : "s"}
        </p>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPageSize(PAGE_SIZE);
          }}
          className="text-xs px-2 py-1 rounded border border-slate-300 bg-white text-[#334155] focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Filter activity by type"
        >
          <option value="all">All activity</option>
          <option value="committee_hearing">Hearings</option>
          <option value="committee_report">Bill reports</option>
          <option value="amendment">Amendments</option>
        </select>
      </div>

      {total === 0 ? (
        <p className="italic text-slate-400 text-sm">
          No recorded activity in the last 90 days.
        </p>
      ) : (
        groupActionsByType(items).map((group) => (
          <section key={group.actionType} className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#595959] mb-2 flex items-baseline gap-2">
              <span>{group.label}</span>
              <span className="text-[10px] font-medium text-slate-400">
                · {group.items.length} record
                {group.items.length === 1 ? "" : "s"}
              </span>
            </h3>
            <ul className="space-y-3">
              {groupBillBatches(group.items).map((entry) => (
                <li
                  key={
                    entry.type === "single"
                      ? entry.action.id
                      : `${entry.actionType}-${entry.date}-${entry.actions[0].id}`
                  }
                >
                  {entry.type === "single" ? (
                    <ActionCard
                      action={entry.action}
                      onSeePassage={onSeePassage}
                    />
                  ) : (
                    <GroupedBillBatch
                      actionType={entry.actionType}
                      date={entry.date}
                      verdict={entry.verdict}
                      actions={entry.actions}
                      onSeePassage={onSeePassage}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

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
