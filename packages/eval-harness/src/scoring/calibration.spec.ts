import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scoreCalibration, type ScoredClaim } from "./calibration.js";

const claims = (
  spec: Array<[confidence: string | number | undefined, anchored: boolean]>,
): ScoredClaim[] =>
  spec.map(([confidence, anchored]) => ({ confidence, anchored }));

const repeat = (
  label: string | undefined,
  anchored: boolean,
  times: number,
): Array<[string | undefined, boolean]> =>
  Array.from(
    { length: times },
    () => [label, anchored] as [string | undefined, boolean],
  );

describe("scoreCalibration", () => {
  test("reads the published ordinal, not a number", () => {
    // The contract is "high" | "medium" | "low". A numeric model of this field
    // reported 0 of 70 claims as carrying confidence, because every one was
    // the string "high".
    const r = scoreCalibration(
      claims([
        ["high", true],
        ["medium", false],
        ["low", false],
      ]),
    );
    assert.equal(r.n, 3);
    assert.equal(r.withoutConfidence, 0);
    assert.deepEqual(
      r.groups.map((g) => g.label),
      ["high", "medium", "low"],
    );
  });

  test("orders levels by the declared enum, not alphabetically", () => {
    const r = scoreCalibration(
      claims([
        ["low", false],
        ["high", true],
        ["medium", false],
      ]),
    );
    assert.deepEqual(
      r.groups.map((g) => g.label),
      ["high", "medium", "low"],
    );
  });

  test("calls a single-valued confidence uninformative, and says so for #1209", () => {
    // The real case: every claim marked "high".
    const r = scoreCalibration(
      claims(repeat("high", false, 9).concat(repeat("high", true, 1))),
    );
    assert.equal(r.distinctLevels, 1);
    assert.equal(r.discrimination, 0);
    assert.match(r.verdict, /single value/i);
    assert.match(r.verdict, /not available as a strategy/i);
  });

  test("excludes claims with no confidence rather than defaulting them", () => {
    const r = scoreCalibration(
      claims([
        ["high", true],
        [undefined, false],
      ]),
    );
    assert.equal(r.n, 1);
    assert.equal(r.withoutConfidence, 1);
  });

  test("points at the contract when nothing carries a confidence", () => {
    // The failure should send a reader to check the field name and type before
    // concluding anything about the model.
    const r = scoreCalibration(
      claims([
        [undefined, true],
        [undefined, false],
      ]),
    );
    assert.equal(r.n, 0);
    assert.match(r.verdict, /wrong name or type/i);
  });

  test("reports the anchoring rate within each level", () => {
    const r = scoreCalibration(
      claims(
        repeat("high", true, 8)
          .concat(repeat("high", false, 2))
          .concat(repeat("low", false, 10)),
      ),
    );
    const high = r.groups.find((g) => g.label === "high");
    const low = r.groups.find((g) => g.label === "low");
    assert.equal(high?.accuracy, 0.8);
    assert.equal(low?.accuracy, 0);
    assert.equal(r.discrimination, 0.8);
  });

  test("reports what filtering to each level would keep and buy", () => {
    const r = scoreCalibration(
      claims(repeat("high", true, 5).concat(repeat("medium", false, 5))),
    );
    const high = r.filters.find((f) => f.atLeast === "high");
    assert.equal(high?.kept, 5);
    assert.equal(high?.precision, 1);
    assert.equal(high?.lift, 0.5);
  });

  test("flags non-monotonic accuracy", () => {
    // "medium" outperforming "high" is worth naming rather than averaging away.
    const r = scoreCalibration(
      claims(
        repeat("high", false, 8)
          .concat(repeat("high", true, 2))
          .concat(repeat("medium", true, 9))
          .concat(repeat("medium", false, 1))
          .concat(repeat("low", false, 10)),
      ),
    );
    assert.equal(r.monotonic, false);
    assert.match(r.verdict, /NOT monotonic/i);
  });

  test("treats a small top-to-bottom gap as noise, not a gate", () => {
    const r = scoreCalibration(
      claims(
        repeat("high", true, 3)
          .concat(repeat("high", false, 7))
          .concat(repeat("low", true, 2))
          .concat(repeat("low", false, 8)),
      ),
    );
    assert.ok(r.discrimination <= 0.1);
    assert.match(r.verdict, /barely separates|No filter buys/i);
  });

  test("accepts numeric confidence for generators that emit one", () => {
    const r = scoreCalibration(
      claims([
        [0.9, true],
        [0.5, false],
      ]),
    );
    assert.equal(r.n, 2);
    assert.equal(r.distinctLevels, 2);
    // Higher numeric confidence must rank first.
    assert.equal(r.groups[0].label, "0.9");
  });

  test("survives an empty claim set", () => {
    const r = scoreCalibration([]);
    assert.equal(r.n, 0);
    assert.match(r.verdict, /No claims to assess/i);
  });
});
