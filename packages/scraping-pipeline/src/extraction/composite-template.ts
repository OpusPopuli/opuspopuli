/**
 * Composite field templates (#1164).
 *
 * Civic listing pages routinely carry the value that discriminates their rows
 * once per PAGE rather than once per item: a measures list states its election
 * date in the heading, an agenda page names its body once, a filings page names
 * its committee once. A `FieldMapping` is one selector plus one transform, so
 * until now there was no way to build `externalId` out of a page-scoped value
 * plus a per-item value — the CSV path had `BulkDownloadConfig.compositeKey`,
 * the HTML path had nothing.
 *
 * A `composite` mapping fills that gap by interpolating fields already
 * extracted for the same item:
 *
 *   {
 *     fieldName: "externalId",
 *     extractionMethod: "composite",
 *     template: "california-sonoma-{electionDate:date}-measure-{measureLetter:lower}",
 *     required: true
 *   }
 *
 * Design notes:
 * - **All-or-nothing.** A missing placeholder yields `undefined`, never a
 *   half-built key like `california-sonoma--measure-e`. externalId is an
 *   upsert key; a silently malformed one corrupts rows across syncs.
 * - **Declaration order.** Dependencies must appear earlier in
 *   `fieldMappings`; the extractor resolves in order, so a composite may also
 *   reference an earlier composite.
 * - **Formatters** keep templates readable without a second transform pass.
 *   `date` is the important one: `date_parse` emits a full ISO timestamp, and
 *   raw interpolation would produce `...-2026-11-03T00:00:00.000Z-...`.
 */

/** Formatters usable as `{field:formatter}`. */
export type CompositeFormatter = "date" | "lower" | "upper" | "slug" | "trim";

/**
 * Bounded on both the path and the formatter so a hostile or hallucinated
 * template can't drive catastrophic backtracking (same posture as safe-regex).
 */
const PLACEHOLDER_RE =
  /\{([A-Za-z0-9_]{1,64}(?:\.[A-Za-z0-9_]{1,64}){0,4})(?::([a-z]{1,8}))?\}/g;

/**
 * Read a possibly dot-nested value out of the item's extracted data.
 *
 * Own-property only: a placeholder like `{toString}` or `{constructor}` must
 * resolve to nothing rather than reaching up the prototype chain and
 * stringifying a built-in into an upsert key.
 */
function readPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.hasOwn(current as object, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Reduce a date to its calendar day.
 *
 * `date_parse` builds `new Date(year, month, day)` — LOCAL midnight — and
 * serialises with `toISOString()`, so on a host at a positive UTC offset the
 * UTC string is the previous day and a naive `slice(0, 10)` shifts the key by
 * one day ("2026-11-03" → "2026-11-02" in Berlin). Read a full timestamp back
 * through local components so it round-trips whatever `date_parse` produced;
 * a bare `YYYY-MM-DD` has no offset to undo and is taken as-is.
 */
function toCalendarDay(value: string): string {
  // Already a bare calendar day, or an instant that is exactly UTC midnight
  // (what date_parse yields on a UTC host, and what a UTC-anchored source
  // gives directly): the leading 10 characters are the answer.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  if (value.startsWith(value.slice(0, 10) + "T00:00:00.000Z")) {
    return value.slice(0, 10);
  }
  // Otherwise the offset came from date_parse's local-midnight construction;
  // read it back through local components to undo exactly that.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function applyFormatter(value: string, formatter?: string): string {
  switch (formatter) {
    case "date":
      // date_parse emits a full ISO timestamp; IDs want the calendar day.
      return toCalendarDay(value);
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "slug":
      return toSlug(value);
    case "trim":
      return value.trim();
    default:
      return value;
  }
}

/**
 * Wall-clock components read back out of a formatted date.
 */
function partsInZone(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(instant)) p[type] = value;
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = p.hour === "24" ? "00" : p.hour;
  return Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(hour),
    Number(p.minute),
    Number(p.second),
  );
}

/**
 * Read a naive timestamp's calendar/clock components into a UTC epoch — the
 * components as written, with no zone applied yet.
 *
 * Parsed explicitly rather than via `Date.parse`, which resolves anything it
 * doesn't recognise as ISO in the HOST's zone and would silently reintroduce
 * the host dependence this whole function exists to remove. Accepts
 * `YYYY-MM-DD` with an optional `H:MM[:SS]` and optional AM/PM — the shapes
 * `date_parse` and civic APIs actually emit.
 */
function parseNaiveWallClock(naive: string): number | undefined {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/.exec(
      naive.trim(),
    );
  if (!m) return undefined;

  let hour = m[4] ? Number(m[4]) : 0;
  const meridiem = m[7]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23) return undefined;

  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    hour,
    m[5] ? Number(m[5]) : 0,
    m[6] ? Number(m[6]) : 0,
  );
}

/**
 * Interpret a timezone-naive timestamp as wall-clock time in `timeZone` and
 * return it as an ISO-8601 instant.
 *
 * Civic APIs routinely publish local wall-clock with no offset — Legistar
 * returns `EventDate` and `EventTime` separately, both naive (#1162). Handing
 * such a string to `new Date()` resolves it in the SERVER's zone: our
 * containers run UTC, so a 2:45 PM Pacific meeting became 2:45 PM UTC and
 * displayed 7 hours early. Wrong-but-confident times are worse than absent
 * ones, so the zone has to be applied explicitly.
 *
 * Solved by iteration rather than a tz table: guess the instant as if the
 * wall-clock were UTC, measure the zone's offset there, correct, then measure
 * once more so a guess that lands on the far side of a DST transition settles
 * on the right side.
 */
export function zonedWallClockToISO(
  naive: string,
  timeZone: string,
): string | undefined {
  const wallClock = parseNaiveWallClock(naive);
  if (wallClock === undefined) return undefined;

  let instant = wallClock;
  for (let i = 0; i < 2; i++) {
    try {
      instant =
        wallClock + (instant - partsInZone(new Date(instant), timeZone));
    } catch {
      return undefined; // invalid IANA zone
    }
  }
  return new Date(instant).toISOString();
}

export interface CompositeResult {
  /** The built string, or undefined when any placeholder was unresolvable. */
  value?: string;
  /**
   * Field paths that resolved to nothing, plus any brace group the
   * placeholder syntax did not recognise — for diagnostics.
   */
  missing: string[];
}

/** Any `{...}` left after substitution — a placeholder we failed to recognise. */
const LEFTOVER_BRACES_RE = /\{[^{}]{0,200}\}/g;

/**
 * Build a composite value from `template` and the item's already-extracted
 * `data`. Returns `{ value: undefined, missing: [...] }` when any referenced
 * field is absent or empty.
 */
export function resolveCompositeTemplate(
  template: string,
  data: Record<string, unknown>,
): CompositeResult {
  const missing: string[] = [];

  const value = template.replaceAll(
    PLACEHOLDER_RE,
    (_match, path: string, formatter?: string) => {
      const raw = readPath(data, path);
      if (raw === null || raw === undefined || raw === "") {
        missing.push(path);
        return "";
      }
      // Arrays/objects (e.g. a `structured` field) are not sensible key parts.
      if (typeof raw === "object") {
        missing.push(path);
        return "";
      }
      return applyFormatter(String(raw), formatter);
    },
  );

  // A brace group the syntax didn't recognise — `{electionDate : date}` with a
  // stray space, `{election-date}` with a hyphen — would otherwise be copied
  // through verbatim and reported as fully resolved, producing a corrupt
  // upsert key. Templates reach us reproduced by an LLM from config hints, so
  // treat anything unconsumed as a failure rather than as literal text.
  const leftovers = value.match(LEFTOVER_BRACES_RE);
  if (leftovers) missing.push(...leftovers);

  if (missing.length > 0) return { value: undefined, missing };
  return { value, missing };
}
