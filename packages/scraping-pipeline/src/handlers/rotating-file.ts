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
 * file's name resolved against it (the directory it is published in).
 */
export function exportUrl(source: DataSourceConfig, now = new Date()): string {
  const rotating = source.bulk?.rotatingFile;
  if (!rotating) return source.url;
  const day = newestWeekday(
    now,
    source.timezone ?? "UTC",
    rotating.publishedAfter,
  );
  return new URL(
    rotating.name.replace("{weekday}", day),
    source.url,
  ).toString();
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
