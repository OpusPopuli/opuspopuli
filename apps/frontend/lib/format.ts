export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);

const DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** A bare calendar date, e.g. "2026-08-28". */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;

/**
 * A timestamp sitting exactly on UTC midnight, e.g.
 * "2026-06-10T00:00:00.000Z" — which is how a Prisma `@db.Date` column
 * reaches the client once it has been through a GraphQL DateTime scalar.
 * The `+00:00` spelling is accepted too: it is the same instant, and which
 * one a serializer emits is not something this should depend on.
 */
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0{1,3})?(?:Z|\+00:00)$/;

/**
 * Formats a date for display, without moving date-only values across a
 * timezone boundary.
 *
 * ── The bug this fixes (#1167) ───────────────────────────────────────────
 *
 * `new Date("2026-06-10T00:00:00.000Z").toLocaleDateString("en-US", …)`
 * renders **"Jun 9, 2026"** anywhere west of UTC, because it converts an
 * instant into the viewer's local zone. Every California visitor — the
 * entire audience — saw civic dates one day early: bill actions, election
 * dates, filing deadlines.
 *
 * The values that carry this shape are `@db.Date` columns
 * (`bills.lastActionDate`, `propositions.electionDate`). They denote a
 * CALENDAR DATE, not an instant: an election is on November 3rd
 * everywhere, and shifting it by the reader's offset is simply wrong.
 *
 * ── Why a heuristic, and what it costs ───────────────────────────────────
 *
 * The wire format is the same `DateTime` scalar for both a date column and
 * a real timestamp, so intent has to be inferred. Exact UTC midnight means
 * date-only; anything else is a genuine instant and keeps converting to
 * local time, which is what a meeting time needs (Sonoma's board meets at
 * 15:30/16:00 UTC — never midnight — so meetings are unaffected).
 *
 * The one thing this gets wrong: an event genuinely occurring at 00:00 UTC
 * renders as its UTC date rather than the viewer's. That is rare, and it
 * is the far smaller error than shifting every election date on the site.
 * If a real UTC-midnight instant ever needs localising, give it its own
 * formatter rather than removing this branch.
 */
export const formatDate = (dateStr: string) => {
  const calendarDate =
    DATE_ONLY.exec(dateStr)?.[1] ?? UTC_MIDNIGHT.exec(dateStr)?.[1];

  if (calendarDate) {
    const [year, month, day] = calendarDate.split("-").map(Number);
    // Built in UTC and rendered in UTC, so the calendar parts survive
    // untouched regardless of where the reader is.
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
      "en-US",
      { ...DISPLAY_OPTIONS, timeZone: "UTC" },
    );
  }

  return new Date(dateStr).toLocaleDateString("en-US", DISPLAY_OPTIONS);
};
