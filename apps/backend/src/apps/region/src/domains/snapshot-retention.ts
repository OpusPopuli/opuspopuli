/** The subset of a snapshot the retention rules need. */
export interface RetainableSnapshot {
  id: string;
  sourceUrl: string;
  fetchedAt: Date;
}

/** How many months keep a monthly snapshot before yearly tiering takes over. */
export const MONTHLY_RETENTION_MONTHS = 12;

/**
 * Choose which snapshots keep their payload (#1277), on a tiered schedule:
 *
 * | tier | kept |
 * |---|---|
 * | newest per source | always |
 * | newest per calendar MONTH | for months within the last 12 |
 * | newest per calendar YEAR | for anything older |
 *
 * Expressed as "what to keep", and the caller deletes the complement. The
 * inverse — computing what to delete — is the shape that loses data when it is
 * wrong: an off-by-one in a keep-list leaves an extra gigabyte on disk, while
 * the same mistake in a delete-list destroys the newest export.
 *
 * ── Why tiered rather than a flat window ────────────────────────────────────
 *
 * **The source does not serve history.** CAL-ACCESS overwrites
 * `dbwebexport.zip` daily; last March's export cannot be re-fetched at any
 * price. So a payload we prune is gone permanently, and any figure published
 * against it becomes unverifiable forever — which is the opposite of what the
 * archive exists for.
 *
 * Measured at 1.52 GB per export, the choice was between a 90-day window
 * (~6 GB flat, nothing reproducible beyond three months) and this schedule
 * (~20 GB at year one, ~26 GB at year five, every month of the last year and
 * every year before it reproducible). ~20 GB of disk for multi-year
 * reproducibility is the cheaper side of that trade by a wide margin.
 *
 * Yearly tiering keys on the newest snapshot IN each year, NOT on December.
 * A node that is down over a year-end — which has happened here, FileVault
 * blocks boot before login — would keep nothing at all for that year under a
 * fixed-month rule.
 *
 * Months and years are bucketed in UTC. A local-time bucket would move the
 * boundary under DST and could silently drop a bucket's only snapshot.
 *
 * @param snapshots - Candidates, in any order
 * @param now - Reference point for "the last 12 months"; injected for tests
 * @returns Ids whose payloads must be retained
 */
export function selectRetainedSnapshots(
  snapshots: readonly RetainableSnapshot[],
  now: Date = new Date(),
): Set<string> {
  const keep = new Set<string>();
  const newestPerSource = new Map<string, RetainableSnapshot>();
  const newestPerSourceMonth = new Map<string, RetainableSnapshot>();
  const newestPerSourceYear = new Map<string, RetainableSnapshot>();
  const monthlyCutoff = monthsBefore(now, MONTHLY_RETENTION_MONTHS);

  for (const snapshot of snapshots) {
    replaceIfNewer(newestPerSource, snapshot.sourceUrl, snapshot);

    // A snapshot earns a monthly slot only while it is inside the window;
    // older ones fall through to the yearly tier. Both indexes are built in
    // one pass so a snapshot is never counted in both and then pruned by the
    // tier that did not claim it.
    if (snapshot.fetchedAt >= monthlyCutoff) {
      replaceIfNewer(
        newestPerSourceMonth,
        snapshot.sourceUrl + ' ' + monthKey(snapshot.fetchedAt),
        snapshot,
      );
    } else {
      replaceIfNewer(
        newestPerSourceYear,
        snapshot.sourceUrl + ' ' + snapshot.fetchedAt.getUTCFullYear(),
        snapshot,
      );
    }
  }

  for (const snapshot of newestPerSource.values()) keep.add(snapshot.id);
  for (const snapshot of newestPerSourceMonth.values()) keep.add(snapshot.id);
  for (const snapshot of newestPerSourceYear.values()) keep.add(snapshot.id);

  return keep;
}

/**
 * `months` calendar months before `from`, in UTC.
 *
 * Calendar arithmetic rather than a 30-day approximation: a fixed day count
 * drifts against month lengths, so the window edge would wander and a
 * month's only snapshot could be dropped a day early.
 */
function monthsBefore(from: Date, months: number): Date {
  const cutoff = new Date(from);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/**
 * Guard against a keep-set that would prune everything.
 *
 * Any non-empty input must retain at least one snapshot per source — the
 * newest, at minimum. A keep-set that does not is a bug in the rules, and the
 * only safe response to "delete all the evidence" is to refuse.
 *
 * @throws when the selection would leave a source with no payload at all
 */
export function assertRetainsSomething(
  snapshots: readonly RetainableSnapshot[],
  keep: ReadonlySet<string>,
): void {
  if (snapshots.length === 0) return;

  const sources = new Set(snapshots.map((s) => s.sourceUrl));
  const keptSources = new Set(
    snapshots.filter((s) => keep.has(s.id)).map((s) => s.sourceUrl),
  );

  if (keptSources.size !== sources.size) {
    const dropped = [...sources].filter((url) => !keptSources.has(url));
    throw new Error(
      'Snapshot retention would prune every payload for: ' +
        dropped.join(', ') +
        '. Refusing to sweep.',
    );
  }
}

/** UTC year-month, the bucket a "monthly" snapshot is kept for. */
function monthKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return date.getUTCFullYear() + '-' + month;
}

function replaceIfNewer(
  index: Map<string, RetainableSnapshot>,
  key: string,
  candidate: RetainableSnapshot,
): void {
  const current = index.get(key);
  if (!current) {
    index.set(key, candidate);
    return;
  }

  // Ties break on id, not on arrival order. The sweep reads candidates with
  // findMany, which guarantees no ordering, so two snapshots sharing a
  // fetchedAt would otherwise be kept or pruned differently from one run to
  // the next — nondeterminism in a destructive operation.
  const newer =
    candidate.fetchedAt > current.fetchedAt ||
    (candidate.fetchedAt.getTime() === current.fetchedAt.getTime() &&
      candidate.id > current.id);

  if (newer) index.set(key, candidate);
}
