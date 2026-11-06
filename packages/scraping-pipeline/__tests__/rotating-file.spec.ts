import { DataType, type DataSourceConfig } from "@opuspopuli/common";
import { exportUrl, newestWeekday } from "../src/handlers/rotating-file";

const PACIFIC = "America/Los_Angeles";

describe("newestWeekday (bills-phase-b.md, D9)", () => {
  it("is today's file once the local publish time has passed", () => {
    // Thu 2026-11-05 21:45 PST
    expect(
      newestWeekday(new Date("2026-11-06T05:45:00Z"), PACIFIC, "21:30"),
    ).toBe("Thu");
  });

  it("is yesterday's file before the local publish time", () => {
    // Fri 2026-11-06 02:00 PST: Friday's file is not out yet
    expect(
      newestWeekday(new Date("2026-11-06T10:00:00Z"), PACIFIC, "21:30"),
    ).toBe("Thu");
  });

  it("reads the clock in the source's zone, not UTC", () => {
    // Thu 22:00 UTC is past 21:30 there, but only 14:00 in California, where
    // Thursday's file is not out yet.
    const at = new Date("2026-11-05T22:00:00Z");
    expect(newestWeekday(at, "UTC", "21:30")).toBe("Thu");
    expect(newestWeekday(at, PACIFIC, "21:30")).toBe("Wed");
  });

  it("wraps from Sunday to Saturday", () => {
    // Sun 2026-11-08 01:00 PST
    expect(
      newestWeekday(new Date("2026-11-08T09:00:00Z"), PACIFIC, "21:30"),
    ).toBe("Sat");
  });

  it("counts the publish minute itself as published", () => {
    // Thu 2026-11-05 21:30 PST exactly
    expect(
      newestWeekday(new Date("2026-11-06T05:30:00Z"), PACIFIC, "21:30"),
    ).toBe("Thu");
  });
});

describe("exportUrl", () => {
  const base: DataSourceConfig = {
    url: "https://downloads.leginfo.legislature.ca.gov/",
    dataType: DataType.BILLS,
    contentGoal: "bills",
    sourceType: "bulk_download",
    timezone: PACIFIC,
    bulk: {
      format: "zip_tsv",
      rotatingFile: {
        name: "pubinfo_daily_{weekday}.zip",
        publishedAfter: "21:30",
      },
    },
  };

  it("resolves the newest file against the directory url", () => {
    expect(exportUrl(base, new Date("2026-11-06T10:00:00Z"))).toBe(
      "https://downloads.leginfo.legislature.ca.gov/pubinfo_daily_Thu.zip",
    );
  });

  it("is the source url for an export that does not rotate", () => {
    const fixed = { ...base, bulk: { format: "zip_tsv" as const } };
    expect(exportUrl(fixed)).toBe(base.url);
  });
});
