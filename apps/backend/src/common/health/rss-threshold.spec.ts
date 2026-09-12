import {
  parseRssThreshold,
  BULK_WORKLOAD_RSS_THRESHOLD,
} from './rss-threshold';

/**
 * The override exists so a node with different sizing can tune the threshold
 * without a release. Every branch here is a way that could silently fail to a
 * number nobody chose — which is worse than the tight default it replaced,
 * because a health check that reports down while the service works correctly
 * is what teaches people to ignore health checks (#642, #1236).
 */
describe('parseRssThreshold', () => {
  const DEFAULT = BULK_WORKLOAD_RSS_THRESHOLD;

  it('uses the default when the env var is absent', () => {
    expect(parseRssThreshold(undefined, DEFAULT)).toBe(DEFAULT);
  });

  it('uses the default for an empty string', () => {
    expect(parseRssThreshold('', DEFAULT)).toBe(DEFAULT);
  });

  it('parses a byte count', () => {
    expect(parseRssThreshold('2147483648', DEFAULT)).toBe(2147483648);
  });

  /**
   * The defect this caught in the original helper (#642's version).
   *
   * `Number.parseInt('3GB', 10)` is 3 — leading digits, then stop — which
   * passed the `> 0` guard and set the threshold to THREE BYTES. Memory is
   * over three bytes on every check, so the service reported unhealthy
   * permanently: the exact symptom the override exists to prevent, produced by
   * the most natural typo for a variable named `..._BYTES`.
   */
  it('falls back on a units suffix rather than reading the leading digits', () => {
    expect(parseRssThreshold('3GB', DEFAULT)).toBe(DEFAULT);
    expect(parseRssThreshold('2048MB', DEFAULT)).toBe(DEFAULT);
    expect(parseRssThreshold('3_000', DEFAULT)).toBe(DEFAULT);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRssThreshold('  2147483648 ', DEFAULT)).toBe(2147483648);
  });

  it('falls back on zero and negatives rather than accepting them', () => {
    expect(parseRssThreshold('0', DEFAULT)).toBe(DEFAULT);
    expect(parseRssThreshold('-1', DEFAULT)).toBe(DEFAULT);
  });

  // Half the 6 GB these containers are provisioned for: a working sync peaked
  // at 1.35 GB, so this tolerates the work while still catching runaway.
  it('defaults bulk workloads to 3 GiB', () => {
    expect(BULK_WORKLOAD_RSS_THRESHOLD).toBe(3 * 1024 * 1024 * 1024);
  });
});
