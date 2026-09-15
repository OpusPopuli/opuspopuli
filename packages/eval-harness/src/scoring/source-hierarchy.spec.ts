import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  zoneMap,
  zoneAt,
  scoreSourceHierarchy,
  type HierarchyClaim,
} from "./source-hierarchy.js";

/**
 * A miniature measure with all three zones, shaped like the real filings:
 * covering letter, enactment, findings, then operative sections.
 */
const TRANSMITTAL =
  "Anabel Renteria, Initiative Coordinator. Enclosed please find the text of " +
  "the measure and a check for $2000. Summary of Measure's Purpose: this " +
  "measure delivers long overdue relief to families.\n";
const MEASURE =
  "THE PEOPLE OF THE STATE OF CALIFORNIA DO ENACT AS FOLLOWS:\n" +
  "SEC. 2. Findings and Declarations. The People find and declare that the " +
  "current system is too slow, too bureaucratic and too costly.\n" +
  "SEC. 3. Section 1234 of the Revenue and Taxation Code is amended to read: " +
  "the rate shall not exceed five percent.\n";
const FULL = TRANSMITTAL + MEASURE;

const at = (needle: string): number => FULL.indexOf(needle);

describe("zoneMap", () => {
  test("splits transmittal, findings and operative", () => {
    const zones = zoneMap(FULL).map((z) => z.zone);
    // NOT an exact array: the enactment clause itself sits between the
    // transmittal boundary and the findings heading, and classifying that
    // sliver as operative is correct. What matters is the ORDER in which the
    // three zones first appear.
    const firstSeen = [...new Set(zones)];
    assert.deepEqual(firstSeen, ["transmittal", "operative", "findings"]);
    assert.ok(zones.length >= 3);
  });

  test("covers the whole document with no gaps or overlaps", () => {
    // A gap would silently drop citations out of the metric.
    const spans = zoneMap(FULL);
    assert.equal(spans[0].start, 0);
    assert.equal(spans[spans.length - 1].end, FULL.length);
    for (let i = 1; i < spans.length; i++) {
      assert.equal(spans[i].start, spans[i - 1].end, `gap before span ${i}`);
    }
  });

  test("places the covering letter before the enactment clause", () => {
    assert.equal(
      zoneAt(zoneMap(FULL), at("Enclosed please find")),
      "transmittal",
    );
  });

  test("places the findings block", () => {
    assert.equal(zoneAt(zoneMap(FULL), at("too bureaucratic")), "findings");
  });

  test("places amended-code text as operative", () => {
    assert.equal(zoneAt(zoneMap(FULL), at("shall not exceed")), "operative");
  });

  test("treats a document with no covering letter as all measure", () => {
    const zones = zoneMap(MEASURE).map((z) => z.zone);
    assert.ok(!zones.includes("transmittal"));
  });

  test("treats a document with no findings as operative throughout", () => {
    const plain =
      "SECTION 1. Section 5 of the Elections Code is amended to read: ballots " +
      "shall be counted within seven days.";
    assert.deepEqual(
      zoneMap(plain).map((z) => z.zone),
      ["operative"],
    );
  });

  test("handles empty text", () => {
    assert.deepEqual(zoneMap(""), []);
  });

  test("defaults an unplaceable offset to operative, not to an error", () => {
    // Conservatism: over-reporting misattribution would undermine the claim
    // this metric exists to make.
    assert.equal(zoneAt([], 42), "operative");
  });
});

describe("scoreSourceHierarchy", () => {
  const claim = (over: Partial<HierarchyClaim>): HierarchyClaim => ({
    claim: "the measure caps the rate at five percent",
    field: "keyProvisions",
    sourceStart: at("shall not exceed"),
    sourceEnd: at("shall not exceed") + 30,
    ...over,
  });

  test("accepts a provision cited from operative text", () => {
    const s = scoreSourceHierarchy([claim({})], FULL);
    assert.equal(s.misattributed, 0);
    assert.equal(s.byZone.operative, 1);
    assert.match(s.verdict, /fall in operative text/i);
  });

  test("flags a provision sourced from the covering letter", () => {
    // The worst case: a campaign document cited as the source for an analysis
    // a citizen is told is checkable.
    const s = scoreSourceHierarchy(
      [claim({ sourceStart: at("Summary of Measure") })],
      FULL,
    );
    assert.equal(s.transmittalCitations, 1);
    assert.equal(s.misattributed, 1);
    assert.match(s.verdict, /COVERING LETTER/);
  });

  test("flags a provision sourced from findings", () => {
    const s = scoreSourceHierarchy(
      [claim({ sourceStart: at("too bureaucratic") })],
      FULL,
    );
    assert.equal(s.findingsCitations, 1);
    assert.equal(s.misattributed, 1);
    assert.match(s.verdict, /written to.*persuade/is);
  });

  test("does not flag a non-operative field drawn from findings", () => {
    // A summary may legitimately draw on findings; a claim about what the law
    // DOES may not. The distinction is the field.
    const s = scoreSourceHierarchy(
      [
        claim({
          field: "analysisSummary",
          sourceStart: at("too bureaucratic"),
        }),
      ],
      FULL,
    );
    assert.equal(s.findingsCitations, 1);
    assert.equal(s.misattributed, 0);
  });

  test("skips out-of-range citations rather than double-counting them", () => {
    // Those are anchoring failures and are counted there.
    const s = scoreSourceHierarchy(
      [claim({ sourceStart: 999_999 }), claim({ sourceStart: -5 })],
      FULL,
    );
    assert.equal(s.scored, 0);
    assert.match(s.verdict, /nothing to assess/i);
  });

  test("reports the zone breakdown alongside the verdict", () => {
    const s = scoreSourceHierarchy(
      [
        claim({}),
        claim({ sourceStart: at("too bureaucratic") }),
        claim({ sourceStart: at("Enclosed please find") }),
      ],
      FULL,
    );
    assert.equal(s.scored, 3);
    assert.equal(s.byZone.operative, 1);
    assert.equal(s.byZone.findings, 1);
    assert.equal(s.byZone.transmittal, 1);
  });
});
