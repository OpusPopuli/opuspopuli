import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  extractFigures,
  numericValue,
  isGrounded,
  scoreGrounding,
} from "./grounding.js";

describe("numericValue", () => {
  test("normalizes magnitude words to a comparable number", () => {
    assert.equal(numericValue("$1.2 million"), 1_200_000);
    assert.equal(numericValue("$1,200,000"), 1_200_000);
    assert.equal(numericValue("3 billion"), 3_000_000_000);
    assert.equal(numericValue("67%"), 67);
  });

  test("returns NaN for text carrying no number", () => {
    assert.ok(Number.isNaN(numericValue("several million")));
  });
});

describe("extractFigures", () => {
  test("finds currency, percentages and magnitudes", () => {
    const f = extractFigures(
      "costs $4.5 million, about 12% of the 3 billion fund",
    );
    assert.deepEqual(
      f.map((x) => x.kind),
      ["currency", "percentage", "quantity"],
    );
  });

  test("counts a currency magnitude once, not twice", () => {
    // "$1.2 million" matches both the currency and the quantity pattern.
    const f = extractFigures("a $1.2 million shortfall");
    assert.equal(f.length, 1);
    assert.equal(f[0].kind, "currency");
  });

  test("ignores section and article numbers", () => {
    // These are structural references, not magnitude claims. Counting them
    // would bury a real fabrication under false positives.
    assert.deepEqual(extractFigures("Section 3 of Article XIII"), []);
  });

  test("does not treat a bare year as a magnitude", () => {
    assert.deepEqual(extractFigures("effective January 1, 2026"), []);
  });
});

describe("isGrounded", () => {
  const source = "The measure appropriates $1,200,000 and sets a 5% cap.";

  test("grounds a paraphrased magnitude against the source value", () => {
    // "$1.2 million" and "$1,200,000" are the same claim written two ways.
    // Requiring a literal string match would score correct paraphrase as
    // fabrication.
    const [fig] = extractFigures("$1.2 million");
    assert.equal(isGrounded(fig, source), true);
  });

  test("rejects a figure whose value is absent", () => {
    const [fig] = extractFigures("$3.4 million");
    assert.equal(isGrounded(fig, source), false);
  });

  test("does not let a number of one kind ground another", () => {
    // A "5" living in a currency or section context must not ground "5%".
    const [pct] = extractFigures("5%");
    assert.equal(isGrounded(pct, "appropriates $5 under Section 5"), false);
  });
});

describe("scoreGrounding", () => {
  test("flags the granite fabrication case", () => {
    // Verbatim from #1142: a measure whose text contains no `$` at all.
    const result = scoreGrounding(
      "This measure generates $1.2 million in new state revenue annually.",
      "An act to require earth sustainability education in public schools.",
    );
    assert.equal(result.fabricated.length, 1);
    assert.equal(result.fabricated[0].raw, "$1.2 million");
    assert.equal(result.rate, 0);
  });

  test("flags the olmo 67% case", () => {
    const result = scoreGrounding(
      "Roughly 67% of districts would be affected.",
      "Districts shall comply with the requirements of this section.",
    );
    assert.equal(result.fabricated.length, 1);
    assert.equal(result.fabricated[0].raw, "67%");
  });

  test("scores an output with no figures as fully grounded", () => {
    // An analysis of a measure with no numbers SHOULD contain no numbers.
    // Scoring this 0 would reward inventing some — the field-completeness
    // trap, one metric over.
    const result = scoreGrounding("The measure changes filing deadlines.", "x");
    assert.equal(result.rate, 1);
    assert.equal(result.figures.length, 0);
  });

  test("scores a fully grounded output as 1", () => {
    const result = scoreGrounding(
      "It appropriates $1.2 million and caps growth at 5%.",
      "appropriates $1,200,000 ... shall not exceed 5% per year",
    );
    assert.equal(result.rate, 1);
    assert.deepEqual(result.fabricated, []);
  });

  test("reports a mixed output proportionally", () => {
    const result = scoreGrounding(
      "It appropriates $1,200,000 and affects 67% of districts.",
      "appropriates $1,200,000 statewide",
    );
    assert.equal(result.grounded.length, 1);
    assert.equal(result.fabricated.length, 1);
    assert.equal(result.rate, 0.5);
  });
});
