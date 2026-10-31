import {
  assertSamePage,
  parseDayOffset,
  resolveFetchUrl,
} from "../src/pipeline/fetch-url";
import { calendarDayInZone } from "../src/extraction/composite-template";

const SENATE = "https://www.senate.ca.gov/calendar?committeeHearings=1";
const LA = "America/Los_Angeles";

describe("resolveFetchUrl (meetings-phase-b.md step 2)", () => {
  // 2026-10-31 03:00 UTC is still Oct 30 in California.
  const now = new Date("2026-10-31T03:00:00Z");

  it("sets each date parameter relative to today in the source's zone", () => {
    const url = new URL(
      resolveFetchUrl(
        {
          url: SENATE,
          dateQueryParams: { startDate: "-30d", endDate: "+60d" },
          timezone: LA,
        },
        now,
      ),
    );

    expect(url.searchParams.get("startDate")).toBe("2026-09-30");
    expect(url.searchParams.get("endDate")).toBe("2026-12-29");
    // The source's own parameters survive.
    expect(url.searchParams.get("committeeHearings")).toBe("1");
  });

  it("returns the source URL untouched when it declares no window", () => {
    expect(resolveFetchUrl({ url: SENATE })).toBe(SENATE);
  });

  it("throws on an offset it cannot read, rather than fetch an unbounded page", () => {
    expect(() =>
      resolveFetchUrl({ url: SENATE, dateQueryParams: { endDate: "60" } }),
    ).toThrow('dateQueryParams.endDate: "60" is not a day offset');
  });
});

describe("parseDayOffset", () => {
  it.each([
    ["+60d", 60],
    ["-30d", -30],
    ["0d", 0],
    ["7d", 7],
  ])("reads %p", (offset, days) => {
    expect(parseDayOffset(offset)).toBe(days);
  });

  it.each(["60", "+60", "d", "+99999d", "1w"])("refuses %p", (offset) => {
    expect(parseDayOffset(offset)).toBeUndefined();
  });
});

describe("calendarDayInZone", () => {
  it("crosses a month end", () => {
    expect(calendarDayInZone(new Date("2026-10-31T18:00:00Z"), LA, 1)).toBe(
      "2026-11-01",
    );
  });
});

describe("assertSamePage", () => {
  it("accepts the same page with a different query", () => {
    expect(() =>
      assertSamePage(`${SENATE}&startDate=2026-10-01`, SENATE),
    ).not.toThrow();
  });

  it.each([
    ["another host", "http://169.254.169.254/latest/meta-data/"],
    [
      "another page",
      "https://www.senate.ca.gov/committees?committeeHearings=1",
    ],
    ["another scheme", "http://www.senate.ca.gov/calendar?committeeHearings=1"],
  ])("refuses %s", (_label, fetchUrl) => {
    expect(() => assertSamePage(fetchUrl, SENATE)).toThrow(
      "is not the page of source",
    );
  });
});
