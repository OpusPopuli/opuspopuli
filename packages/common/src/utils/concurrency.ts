/**
 * Run `fn` over `items` with at most `limit` calls in flight, resolving with
 * the results in ITEM order whatever order they finished in. A rejection is
 * the caller's to avoid (catch inside `fn`): the first one rejects the whole
 * map — but only once every call already started has FINISHED, and nothing
 * new starts after it. So an abort thrown from `fn` (a run's
 * consecutive-failure limit) stops the work rather than just the wait for it:
 * no call is still running, side effects and all, when the caller's catch
 * cleans up.
 *
 * The bound is on concurrency, not on rate — pair it with a rate limiter
 * (the per-host token bucket, S1) where a remote site's budget matters.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `mapWithConcurrency: limit must be a positive integer, got ${limit}`,
    );
  }
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  );
  const rejected = settled.find(
    (s): s is PromiseRejectedResult => s.status === "rejected",
  );
  if (rejected) throw rejected.reason;
  return results;
}
