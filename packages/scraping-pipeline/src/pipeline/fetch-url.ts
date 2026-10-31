/**
 * The URL a source is fetched from, as opposed to `source.url`, the URL it is
 * keyed by (meetings-phase-b.md step 2).
 *
 * The Senate calendar returns only the dates its query names, and with no
 * dates it returns today. A fixed date range in the config goes stale, so the
 * range is declared as day offsets and resolved here at fetch time:
 *
 *   "dateQueryParams": { "startDate": "-30d", "endDate": "+60d" }
 *
 * Only the fetch sees the resolved URL. Manifests, the analysis job's
 * dedupe and every log keep `source.url`, so a URL that changes daily does
 * not mint a new manifest per day.
 */

import type { DataSourceConfig } from "@opuspopuli/common";
import { calendarDayInZone } from "../extraction/composite-template.js";

/** `+60d`, `-30d`, `0d`. Bounded so a typo cannot ask for year 9999. */
const DAY_OFFSET_RE = /^([+-]?)(\d{1,4})d$/;

export function parseDayOffset(offset: string): number | undefined {
  const m = DAY_OFFSET_RE.exec(offset);
  if (!m) return undefined;
  const days = Number(m[2]);
  return m[1] === "-" ? -days : days;
}

/**
 * Throws on an offset it cannot read: a config error should fail the source
 * loudly, not fetch the page with no date range (which, for the Senate, looks
 * like a quiet day rather than a broken source).
 */
export function resolveFetchUrl(
  source: Pick<DataSourceConfig, "url" | "dateQueryParams" | "timezone">,
  now: Date = new Date(),
): string {
  const params = source.dateQueryParams;
  if (!params || Object.keys(params).length === 0) return source.url;

  const url = new URL(source.url);
  for (const [name, offset] of Object.entries(params)) {
    const days = parseDayOffset(offset);
    if (days === undefined) {
      throw new Error(
        `dateQueryParams.${name}: "${offset}" is not a day offset like "+60d" or "-30d"`,
      );
    }
    url.searchParams.set(
      name,
      calendarDayInZone(now, source.timezone ?? "UTC", days),
    );
  }
  return url.toString();
}

/**
 * A fetch URL may differ from its source URL only in the query. The analysis
 * worker takes `fetchUrl` off a queue job and saves what it finds under
 * `sourceUrl`, so a job naming another host or page would build the source's
 * manifest from someone else's HTML, and point the worker's fetch wherever
 * the job said.
 */
export function assertSamePage(fetchUrl: string, sourceUrl: string): void {
  if (fetchUrl === sourceUrl) return;
  const fetch = new URL(fetchUrl);
  const source = new URL(sourceUrl);
  if (fetch.origin !== source.origin || fetch.pathname !== source.pathname) {
    throw new Error(
      `fetchUrl ${fetch.origin}${fetch.pathname} is not the page of source ${sourceUrl}`,
    );
  }
}
