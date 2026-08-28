"use client";

import { useActivityFeed } from "@/lib/hooks";
import { PetitionActivityItem } from "@/lib/graphql/documents";

export function formatRelativeTime(date: Date | string): string {
  const now = Date.now();
  const diffMs = now - new Date(date).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\u2026";
}

function Sparkline({
  hourlyTrend,
}: {
  hourlyTrend: { hour: Date | string; scanCount: number }[];
}) {
  const maxCount = Math.max(...hourlyTrend.map((b) => b.scanCount), 1);
  return (
    <div className="flex items-end gap-px h-10" aria-label="Hourly scan trend">
      {hourlyTrend.map((bucket, i) => {
        const heightPct = (bucket.scanCount / maxCount) * 100;
        return (
          <div
            key={i}
            className="flex-1 bg-accent rounded-t-sm min-w-[2px] transition-all"
            style={{ height: `${Math.max(heightPct, 4)}%` }}
            title={`${bucket.scanCount} scans`}
          />
        );
      })}
    </div>
  );
}

function ActivityItem({ item }: { item: PetitionActivityItem }) {
  return (
    // A hairline card. Semantic tokens throughout so it reads correctly both
    // inside the camera shell (where `.on-fixed-dark` remaps them to paper) and
    // on the normal app surface once subtask 7 lifts that shell off (#1075).
    <div className="px-4 py-3 rounded-lg border border-line">
      <p className="text-sm text-content mb-1">
        {truncate(item.summary || "Petition document", 120)}
      </p>
      <div className="flex items-center gap-3 text-xs text-content-dim">
        <span>
          Scanned {item.scanCount} {item.scanCount === 1 ? "time" : "times"} in{" "}
          {item.locationCount}{" "}
          {item.locationCount === 1 ? "location" : "locations"}
        </span>
        <span>{formatRelativeTime(item.latestScanAt)}</span>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      className="space-y-3 animate-pulse"
      data-testid="activity-feed-loading"
    >
      <div className="h-4 bg-surface-alt rounded w-3/4" />
      <div className="h-10 bg-surface-alt rounded" />
      <div className="h-16 bg-surface-alt rounded" />
      <div className="h-16 bg-surface-alt rounded" />
    </div>
  );
}

export function ActivityFeed() {
  const { feed, loading, error } = useActivityFeed();

  if (error) return null;

  if (loading && !feed) {
    return (
      <section className="w-full max-w-sm mt-8">
        <LoadingSkeleton />
      </section>
    );
  }

  if (!feed || (feed.totalScansLast24h === 0 && feed.items.length === 0)) {
    return (
      <section className="w-full max-w-sm mt-8 text-center">
        <p className="text-sm text-content-dim">
          No petition activity in the last 24 hours. Be the first to scan!
        </p>
      </section>
    );
  }

  return (
    <section className="w-full max-w-sm mt-8" data-testid="activity-feed">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive-solid opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-positive-solid" />
        </span>
        <span className="text-xs font-medium text-positive">Live</span>
      </div>

      <p className="text-sm text-content-dim mb-3">
        <span className="text-content font-semibold">
          {feed.totalScansLast24h}
        </span>{" "}
        {feed.totalScansLast24h === 1 ? "scan" : "scans"} in the last 24 hours
        across{" "}
        <span className="text-content font-semibold">
          {feed.activePetitionsLast24h}
        </span>{" "}
        {feed.activePetitionsLast24h === 1 ? "petition" : "petitions"}
      </p>

      {feed.hourlyTrend.length > 0 && (
        <div className="mb-4">
          <Sparkline hourlyTrend={feed.hourlyTrend} />
          <p className="text-sm text-content-dim mt-1">Last 24 hours</p>
        </div>
      )}

      {feed.items.length > 0 && (
        <div className="space-y-2">
          {feed.items.map((item) => (
            <ActivityItem key={item.contentHash} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
