/**
 * Something a {@link BulkDownloadScope} holds until it closes: a downloaded
 * export, for example, whose temp file `release` deletes.
 */
export interface ScopedDownload {
  release(): Promise<void>;
}

/**
 * One sync's shared downloads (`docs/plans/campaign-finance-phase-b.md`, D4).
 *
 * California's seven campaign-finance sources are seven files inside one
 * 1.6 GB export. Each used to download it again, and the publisher refreshes
 * it daily, so a sync running across the refresh read two different exports
 * (F4). Within a scope, the first `acquire` of a key runs `download` and
 * every later one gets the same result, so every source reads one export.
 *
 * A failed download is held too. The sources sharing it fail together
 * rather than a later one fetching a newer export than the ones before it.
 */
export interface BulkDownloadScope {
  acquire<T extends ScopedDownload>(
    key: string,
    download: () => Promise<T>,
  ): Promise<T>;
  /** Releases everything acquired. Safe to call more than once. */
  close(): Promise<void>;
  /**
   * When the sync began. A rotating export (a file per weekday) is resolved
   * from this, not from each source's own clock, so a sync that runs across
   * the publisher's hour still reads one day's file (bills-phase-b.md).
   */
  readonly startedAt: Date;
}

export function createBulkDownloadScope(
  startedAt: Date = new Date(),
): BulkDownloadScope {
  const held = new Map<string, Promise<ScopedDownload>>();
  let closed = false;
  return {
    startedAt,
    acquire<T extends ScopedDownload>(
      key: string,
      download: () => Promise<T>,
    ): Promise<T> {
      if (closed) {
        return Promise.reject(new Error(`Download scope closed: ${key}`));
      }
      let pending = held.get(key);
      if (!pending) {
        pending = download();
        held.set(key, pending);
      }
      // Unchecked: entries are keyed by URL alone, so every caller of one key
      // must ask for the same T. The bulk-download handler is the only caller,
      // and the scope is created by plugins that never see its download type,
      // which is why T is per call rather than per scope.
      return pending as Promise<T>;
    },
    async close(): Promise<void> {
      closed = true;
      const pending = [...held.values()];
      held.clear();
      await Promise.allSettled(pending.map(async (p) => (await p).release()));
    },
  };
}
