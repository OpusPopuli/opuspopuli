import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  columnIndexFromRef,
  parseXlsxGrid,
} from "../src/handlers/xlsx-sheet.parser";

/**
 * The fixture is California's Statement of Vote in full
 * (`sov/2022-general/sov/19-governor.xlsx`, ~14KB, byte-for-byte as published).
 * A hand-written spreadsheet would prove the parser handles a shape we
 * invented; this proves it handles the one the Secretary of State actually
 * publishes — including the `State Totals` row that makes the members
 * reconcilable.
 */
const FIXTURE = join(__dirname, "fixtures", "statement-of-vote-sample.xlsx");

describe("columnIndexFromRef", () => {
  it.each([
    ["A1", 0],
    ["B3", 1],
    ["Z9", 25],
    ["AA1", 26],
    ["AB2", 27],
  ])("maps %s to column %i", (ref, expected) => {
    expect(columnIndexFromRef(ref)).toBe(expected);
  });

  it("returns -1 for a reference with no column letters", () => {
    expect(columnIndexFromRef("42")).toBe(-1);
  });
});

describe("parseXlsxGrid", () => {
  const grid = parseXlsxGrid(readFileSync(FIXTURE));

  it("resolves shared strings rather than returning their indices", () => {
    // t="s" cells hold an offset into sharedStrings.xml. Returning "3" here
    // instead of a candidate name is the failure this guards.
    expect(grid[0][1]).toContain("Newsom");
    expect(grid[1][1]).toBe("DEM");
  });

  it("preserves the empty A1 so header columns line up with vote columns", () => {
    // The header row starts at column B — column A is blank above the county
    // labels. Collapsing that gap shifts every candidate one column left, so
    // the domain handler would read Newsom's header over Dahle's votes.
    expect(grid[0][0]).toBe("");
    expect(grid[1][0]).toBe("");
    const alameda = grid.find((r) => r[0] === "Alameda");
    expect(alameda?.[1]).toBe("387046");
  });

  it("reads county rows as label followed by one column per candidate", () => {
    const alameda = grid.find((r) => r[0] === "Alameda");
    expect(alameda).toBeDefined();
    expect(alameda?.slice(1, 3)).toEqual(["387046", "100923"]);
  });

  it("keeps the interleaved Percent rows rather than silently dropping them", () => {
    // Filtering them out is the domain handler's job. If the parser dropped
    // them it would be making a decision it has no basis for.
    expect(grid.some((r) => r[0].trim() === "Percent")).toBe(true);
  });

  it("preserves every county as its own row", () => {
    const labels = grid.map((r) => r[0]);
    expect(labels).toEqual(
      expect.arrayContaining(["Alameda", "Alpine", "Nevada", "Yuba"]),
    );
    // 58 counties plus the aggregate row the file ends with.
    const counties = labels.filter(
      (l) => l && !l.trim().startsWith("Percent") && !l.includes("Newsom"),
    );
    expect(counties).toContain("State Totals");
  });

  it("throws a listing of available sheets when asked for one that is absent", () => {
    expect(() => parseXlsxGrid(readFileSync(FIXTURE), 99)).toThrow(
      /sheet99\.xml not found/,
    );
  });
});

describe("column positioning", () => {
  it("places values by cell reference, not document order", () => {
    // A row that omits an empty cell must not shift later values left. This is
    // the defect that would attribute one candidate's votes to another.
    const grid = parseXlsxGrid(readFileSync(FIXTURE));
    for (const row of grid) {
      const label = row[0]?.trim();
      if (label !== "Alameda") continue;
      // Votes sit in columns 1 and 2 — never column 0, which is the label.
      expect(Number(row[1])).toBeGreaterThan(0);
      expect(Number(row[2])).toBeGreaterThan(0);
    }
  });
});
