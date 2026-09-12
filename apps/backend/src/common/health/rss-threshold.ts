/** Bytes in a gibibyte, for readable threshold arithmetic. */
const GIB = 1024 * 1024 * 1024;

/**
 * RSS threshold for a service that streams bulk downloads and parses PDFs.
 *
 * Half of the 6 GB these containers are provisioned for: high enough that a
 * working sync does not trip it, low enough that genuine runaway still does.
 *
 * The in-process default (1 GB, `memory.health.ts`) suits a request-serving
 * service. It does not suit one whose job is to pull a bulk archive into
 * memory — measured at 1.7 GB on `region-service` (#642) and 1.35 GB on
 * `region-worker` (#1236), both against the same 6 GB limit.
 */
export const BULK_WORKLOAD_RSS_THRESHOLD = 3 * GIB;

/**
 * Parse a positive integer byte count from an env var; fall back to
 * `defaultBytes` if absent or invalid.
 *
 * Lets a node with different sizing tune the threshold without a release —
 * which matters because the right number is a property of the deployment, not
 * of the code, and the failure it guards against (a health check that reports
 * down while the service works correctly) trains people to ignore health
 * checks.
 *
 * Shared rather than copied: this began as a local helper in the region
 * service (#642), and #1236 was the region worker needing the identical thing
 * after #1122 moved the bulk work there.
 */
export function parseRssThreshold(
  raw: string | undefined,
  defaultBytes: number,
): number {
  if (!raw) return defaultBytes;

  // Whole-string match, NOT bare `parseInt`.
  //
  // `Number.parseInt('3GB', 10)` is 3 — it reads the leading digits and stops.
  // That passes a `> 0` guard and sets the RSS threshold to *three bytes*, so
  // memory is over threshold on every check and the service reports unhealthy
  // for the rest of its life. A units suffix is the obvious thing to type into
  // a variable named `..._BYTES`, and the symptom is indistinguishable from the
  // problem this override exists to fix.
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return defaultBytes;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : defaultBytes;
}
