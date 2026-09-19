/** The subset of a snapshot the retention rules need. */
export interface RetainableSnapshot {
  id: string;
  sourceUrl: string;
  fetchedAt: Date;
}

/**
 * Choose which snapshots keep their payload: the latest, plus one per calendar
 * month, per source (#1277).
 *
 * Expressed as "what to keep", and the caller deletes the complement. The
 * inverse — computing what to delete — is the shape that loses data when it is
 * wrong: an off-by-one in a keep-list leaves an extra gigabyte on disk, while
 * the same mistake in a delete-list destroys the newest export.
 *
 * Months are bucketed in UTC. A local-time bucket would move the boundary
 * under DST and could silently drop a month's only snapshot.
 *
 * @param snapshots - Candidates, in any order
 * @returns Ids whose payloads must be retained
 */
export function selectRetainedSnapshots(
  snapshots: readonly RetainableSnapshot[],
): Set<string> {
  const keep = new Set<string>();
  const newestPerSource = new Map<string, RetainableSnapshot>();
  const newestPerSourceMonth = new Map<string, RetainableSnapshot>();

  for (const snapshot of snapshots) {
    replaceIfNewer(newestPerSource, snapshot.sourceUrl, snapshot);
    replaceIfNewer(
      newestPerSourceMonth,
      snapshot.sourceUrl + ' ' + monthKey(snapshot.fetchedAt),
      snapshot,
    );
  }

  for (const snapshot of newestPerSource.values()) keep.add(snapshot.id);
  for (const snapshot of newestPerSourceMonth.values()) keep.add(snapshot.id);

  return keep;
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
