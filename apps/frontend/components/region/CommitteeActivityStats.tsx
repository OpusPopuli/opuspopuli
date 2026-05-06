"use client";

import { useQuery } from "@apollo/client/react";
import {
  GET_COMMITTEE_ACTIVITY_STATS,
  type CommitteeActivityStats as Stats,
} from "@/lib/graphql/region";

interface Data {
  committeeActivityStats: Stats;
}

interface Vars {
  committeeId: string;
  sinceDays?: number;
}

/**
 * At-a-glance counters for the legislative committee detail page
 * Layer 3 — recent hearings held, bills reported out, amendments
 * touching the committee. Mirrors the rep ActivityStats but with
 * committee-specific tiles. Issue #665.
 */
export function CommitteeActivityStats({
  committeeId,
  sinceDays = 90,
}: {
  readonly committeeId: string;
  readonly sinceDays?: number;
}) {
  const { data, loading, error } = useQuery<Data, Vars>(
    GET_COMMITTEE_ACTIVITY_STATS,
    { variables: { committeeId, sinceDays } },
  );

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 animate-pulse"
        aria-busy="true"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={`cmt-stat-skel-${i.toString()}`}
            className="h-24 rounded-lg bg-slate-100"
          />
        ))}
      </div>
    );
  }

  const stats = data?.committeeActivityStats;
  if (error || !stats) {
    return null;
  }

  return (
    <section aria-label="Committee activity at a glance" className="mb-8">
      <p className="text-xs font-bold uppercase tracking-wider text-[#595959] mb-3">
        Last {sinceDays} days
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Hearings" value={String(stats.hearings)} />
        <StatTile label="Bills reported" value={String(stats.reports)} />
        <StatTile label="Amendments" value={String(stats.amendments)} />
        <StatTile
          label="Distinct bills"
          value={String(stats.distinctBills)}
          sub="touched by any action"
        />
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  sub,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#595959] mb-1">
        {label}
      </p>
      <p className="text-2xl font-semibold text-[#222222]">{value}</p>
      {sub && <p className="text-[11px] text-[#595959] mt-1 truncate">{sub}</p>}
    </div>
  );
}
