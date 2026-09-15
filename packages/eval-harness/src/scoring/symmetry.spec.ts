import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  profileTreatment,
  compareTreatment,
  scoreYesNoSymmetry,
  comparePairTreatment,
  summarizePairedDifferences,
  type PairTreatment,
} from "./symmetry.js";

describe("profileTreatment", () => {
  test("counts hedges and reports them per 100 words", () => {
    const p = profileTreatment(
      "The measure may reduce costs and could possibly affect some districts.",
    );
    assert.ok(p.hedges >= 3, `expected >= 3 hedges, got ${p.hedges}`);
    assert.ok(p.hedgeDensity > 0);
  });

  test("density is length-independent", () => {
    const short = profileTreatment("It may apply.");
    const long = profileTreatment(
      `It may apply. ${"Filler words here. ".repeat(20)}`,
    );
    // Same single hedge, very different lengths — the density must fall.
    assert.ok(short.hedgeDensity > long.hedgeDensity);
  });

  test("counts intensifiers separately from hedges", () => {
    const p = profileTreatment(
      "This would dramatically and severely change the law.",
    );
    assert.equal(p.intensifiers, 2);
    assert.equal(p.hedges, 0);
  });

  test("handles empty text without dividing by zero", () => {
    const p = profileTreatment("");
    assert.equal(p.words, 0);
    assert.equal(p.hedgeDensity, 0);
    assert.equal(p.sentences, 0);
  });
});

describe("compareTreatment", () => {
  test("reports symmetric text as symmetric", () => {
    const a = "Voters would approve the change. The rule takes effect in 2027.";
    const b = "Voters would reject the change. The rule stays as it is today.";
    const c = compareTreatment(a, b);
    assert.ok(c.lengthRatio > 0.8);
    assert.deepEqual(c.flags, []);
  });

  test("flags one side being substantially longer", () => {
    const c = compareTreatment(
      `A yes vote does this. ${"It also does this. ".repeat(12)}`,
      "A no vote keeps current law.",
      "yes",
      "no",
    );
    assert.ok(c.lengthRatio < 0.6);
    assert.match(c.flags.join(" "), /yes is substantially longer/);
  });

  test("flags a hedging gap and says which side hedges more", () => {
    const hedged =
      "This may possibly affect some districts and could potentially seem unclear.";
    const flat = "This changes the tax rate. The rate becomes five percent.";
    const c = compareTreatment(hedged, flat, "yes", "no");
    assert.ok(c.hedgeDelta > 0, "hedged side should carry the positive delta");
    assert.match(c.flags.join(" "), /yes hedges more/);
  });

  test("carries the sign so direction is recoverable", () => {
    const hedged = "It may possibly apply.";
    const flat = "It applies.";
    assert.ok(compareTreatment(hedged, flat).hedgeDelta > 0);
    assert.ok(compareTreatment(flat, hedged).hedgeDelta < 0);
  });

  test("does not flag negation asymmetry", () => {
    // A measure that PROHIBITS something legitimately attracts negations on one
    // side of its own yes/no framing. Flagging it would fire on correct
    // analyses of restrictive measures.
    const c = compareTreatment(
      "The measure prohibits new taxes and prevents retroactive levies.",
      "Current law continues.",
      "yes",
      "no",
    );
    assert.ok(c.negationDelta !== 0);
    assert.ok(!c.flags.join(" ").includes("negation"));
  });
});

describe("scoreYesNoSymmetry", () => {
  test("compares yesOutcome against noOutcome", () => {
    const c = scoreYesNoSymmetry({
      yesOutcome: "Schools receive continued funding from the existing tax.",
      noOutcome: "The existing tax expires and that funding ends.",
    });
    assert.ok(c.lengthRatio > 0.7);
  });

  test("detects a fuller, more confident yes than no", () => {
    // The thumb-on-the-scale case: content is controlled (one measure, one
    // prompt), so a systematic gap is treatment rather than subject matter.
    const c = scoreYesNoSymmetry({
      yesOutcome: `Voters would secure lasting protection. ${"This delivers real benefits. ".repeat(10)}`,
      noOutcome: "Nothing changes.",
    });
    assert.ok(c.lengthRatio < 0.6);
    assert.ok(c.flags.length > 0);
  });

  test("treats a missing field as empty rather than throwing", () => {
    const c = scoreYesNoSymmetry({ yesOutcome: "Something happens." });
    assert.equal(c.b.words, 0);
  });
});

describe("comparePairTreatment", () => {
  test("reports provision and field parity alongside the summary comparison", () => {
    const p = comparePairTreatment(
      "tax-raise-vs-tax-limit",
      {
        analysisSummary: "Extends an existing tax to fund schools.",
        keyProvisions: ["a", "b", "c"],
        yesOutcome: "y",
      },
      {
        analysisSummary: "Limits the ability of voters to raise revenue.",
        keyProvisions: ["a"],
        yesOutcome: "y",
      },
      "raise",
      "limit",
    );
    assert.equal(p.provisionsA, 3);
    assert.equal(p.provisionsB, 1);
    assert.equal(p.fieldsA, 2);
  });
});

describe("summarizePairedDifferences", () => {
  const pair = (hedgeDelta: number): PairTreatment =>
    ({
      pairId: "p",
      summary: {
        a: profileTreatment("x"),
        b: profileTreatment("x"),
        lengthRatio: 1,
        hedgeDelta,
        intensifierDelta: 0,
        negationDelta: 0,
        flags: [],
      },
      provisionsA: 1,
      provisionsB: 1,
      fieldsA: 1,
      fieldsB: 1,
    }) as PairTreatment;

  test("surfaces a consistent lean as same-sign agreement", () => {
    // Five pairs all hedging the same direction is the systematic-bias shape.
    const s = summarizePairedDifferences([4, 3, 5, 2, 6].map(pair));
    assert.equal(s.pairs, 5);
    assert.equal(s.sameSignHedge, 5);
    assert.ok(s.meanHedgeDelta > 0);
  });

  test("shows noise as a near-zero mean and a split sign", () => {
    const s = summarizePairedDifferences([4, -3, 5, -6].map(pair));
    assert.equal(s.sameSignHedge, 2);
    assert.ok(Math.abs(s.meanHedgeDelta) < 1);
  });

  test("handles an empty set", () => {
    const s = summarizePairedDifferences([]);
    assert.equal(s.pairs, 0);
    assert.equal(s.meanLengthRatio, 1);
  });
});
