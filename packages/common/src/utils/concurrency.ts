/**
 * Run `fn` over `items` with at most `limit` calls in flight, resolving with
 * the results in ITEM order whatever order they finished in. A rejection is
 * the caller's to avoid (catch inside `fn`): the first one rejects the whole
 * map, as `Promise.all` does, while calls already started run to completion.
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
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  );
  return results;
}
