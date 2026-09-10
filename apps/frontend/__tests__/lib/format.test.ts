/**
 * These tests depend on running WEST of UTC, which `jest.globalSetup.js`
 * guarantees by pinning TZ to America/Los_Angeles.
 *
 * #1167 is invisible in UTC: `new Date(utcMidnight).toLocaleDateString()`
 * only shifts the day once the viewer is west of UTC, so in the default CI
 * timezone these assertions pass against the BROKEN implementation and
 * guard nothing.
 *
 * Setting `process.env.TZ` here instead does not work — Node resolves the
 * zone before module code runs. That mistake is why the first version of
 * this file passed locally (where TZ was exported on the command line) and
 * failed in CI.
 */
import { formatCurrency, formatDate } from "@/lib/format";

describe("formatDate", () => {
  describe("date-only values keep their calendar date (#1167)", () => {
    // How a Prisma @db.Date column arrives after the GraphQL DateTime
    // scalar — this is the real wire shape, verified against the API.
    it("renders a UTC-midnight timestamp as that date, not the day before", () => {
      expect(formatDate("2026-06-10T00:00:00.000Z")).toBe("Jun 10, 2026");
    });

    it("handles the no-milliseconds spelling", () => {
      expect(formatDate("2026-11-03T00:00:00Z")).toBe("Nov 3, 2026");
    });

    it("handles the +00:00 offset spelling of the same instant", () => {
      expect(formatDate("2026-06-10T00:00:00.000+00:00")).toBe("Jun 10, 2026");
    });

    it("handles a bare calendar date", () => {
      expect(formatDate("2026-08-28")).toBe("Aug 28, 2026");
    });

    // An election is on the 3rd everywhere; shifting it by the reader's
    // offset is the specific harm this guards against.
    it("does not shift an election date backwards in a westward zone", () => {
      expect(formatDate("2026-11-03T00:00:00.000Z")).not.toBe("Nov 2, 2026");
    });

    it("keeps the year and month correct across a year boundary", () => {
      // The worst case: UTC midnight on Jan 1 renders as Dec 31 of the
      // PREVIOUS year when converted westward.
      expect(formatDate("2026-01-01T00:00:00.000Z")).toBe("Jan 1, 2026");
    });
  });

  describe("real timestamps still convert to local time", () => {
    // Sonoma's Board of Supervisors sits at 15:30 UTC — 08:30 Pacific,
    // same calendar day. A meeting time must localise; only date-only
    // values are exempt.
    it("renders a mid-day UTC timestamp on its local calendar day", () => {
      expect(formatDate("2026-09-15T15:30:00.000Z")).toBe("Sep 15, 2026");
    });

    // Late-evening UTC genuinely IS the previous day in Pacific, and
    // should render that way — the fix must not over-correct.
    it("still moves a late-UTC instant back a day when that is correct", () => {
      expect(formatDate("2026-09-15T03:00:00.000Z")).toBe("Sep 14, 2026");
    });
  });
});

describe("formatCurrency", () => {
  it("formats whole dollars", () => {
    expect(formatCurrency(1234)).toBe("$1,234.00");
  });

  it("formats cents", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });
});
