import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  scoreOmission,
  calibrateThreshold,
  type GoldProvision,
} from "./omission.js";

const gold = (n: number, essential = false): GoldProvision[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    text: `provision ${i + 1}`,
    essential,
  }));

/** Similarity from an explicit matrix: rows are gold, columns emitted. */
const matrix =
  (m: number[][]) =>
  (g: number, e: number): number =>
    m[g]?.[e] ?? 0;

describe("calibrateThreshold", () => {
  test("puts the cut above the null distribution", () => {
    // Unrelated provisions cluster low; the threshold must sit above them.
    const negatives = [0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
    const c = calibrateThreshold(negatives, 0.95, 0.0);
    assert.ok(c.threshold >= 0.55, `expected >= 0.55, got ${c.threshold}`);
    assert.ok(c.nullMean < c.threshold);
  });

  test("applies a floor when unrelated text already scores high", () => {
    // If everything is similar to everything, a calibrated threshold would
    // silently pass all matches. The floor makes that fail loudly instead.
    const c = calibrateThreshold([0.1, 0.1, 0.1], 0.95, 0.5);
    assert.equal(c.threshold, 0.5);
  });

  test("falls back to the floor with no negatives to learn from", () => {
    const c = calibrateThreshold([], 0.95, 0.5);
    assert.equal(c.threshold, 0.5);
    assert.equal(c.n, 0);
  });

  test("reports the null distribution it derived the cut from", () => {
    const c = calibrateThreshold([0.2, 0.3, 0.4], 0.95, 0.0);
    assert.equal(c.n, 3);
    assert.ok(c.nullMean > 0);
  });
});

describe("scoreOmission", () => {
  test("counts a paraphrase as recalled", () => {
    // The whole point: the gold is in the measure's register, the output in a
    // voter's. Exact matching would score correct rewriting as omission.
    const s = scoreOmission(
      gold(1),
      ["a plain-language rewrite"],
      matrix([[0.82]]),
      0.6,
    );
    assert.equal(s.recalled, 1);
    assert.equal(s.matches[0].matchedTo, "a plain-language rewrite");
  });

  test("counts a provision below threshold as omitted", () => {
    const s = scoreOmission(gold(1), ["something else"], matrix([[0.31]]), 0.6);
    assert.equal(s.recalled, 0);
    assert.equal(s.matches[0].recalled, false);
    assert.equal(s.matches[0].matchedTo, undefined);
  });

  test("takes the best match across everything emitted", () => {
    const s = scoreOmission(
      gold(1),
      ["unrelated", "close enough", "also unrelated"],
      matrix([[0.1, 0.77, 0.2]]),
      0.6,
    );
    assert.equal(s.matches[0].bestScore, 0.77);
    assert.equal(s.matches[0].matchedTo, "close enough");
  });

  test("reports essential recall separately from overall recall", () => {
    // Dropping a severability clause is not dropping the thing the measure
    // does, and one number for both would hide the difference.
    const provisions: GoldProvision[] = [
      { id: "p1", text: "the measure caps rates", essential: true },
      { id: "p2", text: "severability", essential: false },
    ];
    const s = scoreOmission(
      provisions,
      ["caps rates"],
      matrix([[0.9], [0.1]]),
      0.6,
    );
    assert.equal(s.recall, 0.5);
    assert.equal(s.essentialRecall, 1);
  });

  test("names the essential provisions a voter would not learn about", () => {
    const provisions: GoldProvision[] = [
      {
        id: "p1",
        text: "employing a non-physician to review a doctor's decision is a felony",
        essential: true,
      },
    ];
    const s = scoreOmission(
      provisions,
      ["something else"],
      matrix([[0.2]]),
      0.6,
    );
    assert.equal(s.essentialRecalled, 0);
    assert.match(s.verdict, /ESSENTIAL/);
    assert.match(s.verdict, /felony/);
    assert.match(s.verdict, /no other metric here would notice/);
  });

  test("does not punish a measure with no essential provisions authored", () => {
    const s = scoreOmission(gold(2), [], matrix([[0], [0]]), 0.6);
    assert.equal(s.essentialTotal, 0);
    assert.equal(s.essentialRecall, 1);
    assert.equal(s.recall, 0);
  });

  test("scores an empty output as total omission, not as success", () => {
    const s = scoreOmission(gold(3, true), [], matrix([]), 0.6);
    assert.equal(s.recall, 0);
    assert.equal(s.essentialRecall, 0);
  });

  test("handles a measure with no gold authored", () => {
    const s = scoreOmission([], ["anything"], matrix([]), 0.6);
    assert.match(s.verdict, /No gold provisions/i);
  });
});
