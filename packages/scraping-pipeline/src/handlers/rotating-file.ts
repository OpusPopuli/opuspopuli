/**
 * Which file a bulk source fetches when its publisher rotates the export by
 * weekday (`bulk.rotatingFile`, `bills-phase-b.md` D9). The California
 * Legislature publishes `pubinfo_daily_<Day>.zip` at about 21:23 Pacific, so
 * at 02:00 the newest file is the previous day's.
 */

import type { DataSourceConfig } from "@opuspopuli/common";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The URL to download: the source url, or for a rotating export the newest
 * file's name resolved against it (the directory it is published in). The
 * name must stay on the source's origin: a config name such as `//host/x.zip`
 * would otherwise move the fetch to another host.
 */
export function exportUrl(source: DataSourceConfig, now = new Date()): string {
  const rotating = source.bulk?.rotatingFile;
  if (!rotating) return source.url;
  const day = newestWeekday(
    now,
    source.timezone ?? "UTC",
    rotating.publishedAfter,
  );
  const url = new URL(rotating.name.replace("{weekday}", day), source.url);
  if (url.origin !== new URL(source.url).origin) {
    throw new Error(
      `Rotating file ${rotating.name} leaves ${source.url}'s origin`,
    );
  }
  return url.toString();
}

/**
 * Oldest a rotating export may be. A daily file is at most about a day old
 * when fetched; one published a week ago means today's has not appeared yet
 * (a run just after `publishedAfter` on a late night), and importing it would
 * write a week-old status over every row that changed since.
 */
export const MAX_ROTATING_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Throws when a rotating export's `last-modified` is older than
 * {@link MAX_ROTATING_AGE_MS}. A missing or unreadable header passes: the
 * guard is for a file known to be stale, not a proof of freshness.
 */
export function assertRotatingFileFresh(
  url: string,
  lastModified: string | null | undefined,
  now = new Date(),
): void {
  const modified = lastModified ? Date.parse(lastModified) : Number.NaN;
  if (Number.isNaN(modified)) return;
  if (now.getTime() - modified > MAX_ROTATING_AGE_MS) {
    throw new Error(
      `${url} was last modified ${lastModified}, over 48 hours ago: not the newest export, so it is not imported over newer data`,
    );
  }
}

/**
 * The weekday, in `timeZone`, of the newest file at `now`: today's once local
 * time has reached `publishedAfter` (HH:MM), otherwise yesterday's.
 */
export function newestWeekday(
  now: Date,
  timeZone: string,
  publishedAfter: string,
): (typeof WEEKDAYS)[number] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const today = WEEKDAYS.indexOf(part("weekday") as (typeof WEEKDAYS)[number]);
  if (today === -1) {
    throw new Error(`Cannot read the weekday in ${timeZone}`);
  }
  const localTime = `${part("hour")}:${part("minute")}`;
  const published = localTime >= publishedAfter;
  return WEEKDAYS[published ? today : (today + 6) % 7];
}
