"use client";

import { useQuery } from "@apollo/client/react";
import {
  GET_REP_ACTIVITY_STATS,
  type RepresentativeActivityStats,
} from "@/lib/graphql/region";

interface Data {
  representativeActivityStats: RepresentativeActivityStats;
}

interface Vars {
  id: string;
  sinceDays?: number;
}

/**
 * At-a-glance counters for the rep detail page Layer 3 — top tile
 * grid summarizing attendance + activity over a 90-day window
 * (configurable via `sinceDays`).
 *
 * Designed to read in 5 seconds for a low-info voter: attendance
 * percentage prominent, activity counts secondary, V2 columns
 * (votes / speeches) only render when non-zero so they don't show
 * as zeros while waiting for V2 data.
 *
 * Issue #665.
 */
export function ActivityStats({
  representativeId,
  sinceDays = 90,
}: {
  readonly representativeId: string;
  readonly sinceDays?: number;
}) {
  const { data, loading, error } = useQuery<Data, Vars>(
    GET_REP_ACTIVITY_STATS,
    { variables: { id: representativeId, sinceDays } },
  );

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 animate-pulse"
        aria-busy="true"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={`stat-skeleton-${i.toString()}`}
            className="h-24 rounded-lg bg-slate-100"
          />
        ))}
      </div>
    );
  }

  if (error || !data?.representativeActivityStats) {
    return null; // Silently degrade — feed below still renders.
  }

  const stats = data.representativeActivityStats;
  const attendanceRate =
    stats.totalSessionDays > 0
      ? Math.round((stats.presentSessionDays / stats.totalSessionDays) * 100)
      : null;

  return (
    <section aria-label="Activity at a glance" className="mb-8">
      <p className="text-xs font-bold uppercase tracking-wider text-[#595959] mb-3">
        Last {sinceDays} days
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Attendance"
          value={attendanceRate !== null ? `${attendanceRate}%` : "—"}
          sub={`${stats.presentSessionDays} of ${stats.totalSessionDays} session days`}
          tone={attendanceTone(attendanceRate)}
        />
        <StatTile
          label="Absences (recorded)"
          value={String(stats.absenceDays)}
          sub="with stated reason"
        />
        <StatTile
          label="Amendments"
          value={String(stats.amendments)}
          sub="floor + committee"
        />
        <StatTile
          label="Hearings"
          value={String(stats.committeeHearings)}
          sub="committee chaired"
        />
        {stats.committeeReports > 0 && (
          <StatTile
            label="Committee reports"
            value={String(stats.committeeReports)}
          />
        )}
        {stats.resolutions > 0 && (
          <StatTile label="Resolutions" value={String(stats.resolutions)} />
        )}
        {stats.votes > 0 && (
          <StatTile label="Floor votes" value={String(stats.votes)} />
        )}
        {stats.speeches > 0 && (
          <StatTile label="Speeches" value={String(stats.speeches)} />
        )}
      </div>
    </section>
  );
}

function attendanceTone(rate: number | null): "neutral" | "good" | "warn" {
  if (rate === null) return "neutral";
  if (rate >= 80) return "good";
  if (rate >= 50) return "neutral";
  return "warn";
}

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: "neutral" | "good" | "warn";
}) {
  let valueClass = "text-[#222222]";
  if (tone === "good") valueClass = "text-emerald-700";
  else if (tone === "warn") valueClass = "text-amber-700";
  return (
    <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#595959] mb-1">
        {label}
      </p>
      <p className={`text-2xl font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#595959] mt-1 truncate">{sub}</p>}
    </div>
  );
}
