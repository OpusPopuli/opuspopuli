import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scoreSectioning } from "./sectioning.js";

/**
 * A measure with headings of its own, as most initiatives have.
 *
 * Joined with SPACES, not newlines, because that is what production stores:
 * `full_text` carries no newlines at all. Newline-separated fixtures passed
 * this suite while `sourceHasHeadings` matched 0 of 125 live measures.
 */
const WITH_HEADINGS = [
  "SECTION 1. Findings and Declarations.",
  "The people of the State of California find and declare as follows:",
  "SEC. 2. Liberal Construction.",
  "This act shall be liberally construed to effectuate its purposes.",
  "SEC. 3. Severability.",
].join(" ");

/** A county bond measure: continuous prose, no headings at all. */
const WITHOUT_HEADINGS =
  "To upgrade classrooms and repair deteriorating school facilities, shall " +
  "Waugh School District issue $38,000,000 of bonds at legal rates, levying " +
  "on average $30 per $100,000 of assessed value annually while bonds are " +
  "outstanding, with annual audits and citizen oversight?";

/** The prompt's OUTPUT FORMAT example, verbatim. */
const COPIED = [
  { heading: "Findings and Declarations" },
  { heading: "Operative Provisions" },
];

describe("scoreSectioning", () => {
  test("counts a heading as grounded when it appears verbatim in the source", () => {
    const result = scoreSectioning(
      [{ heading: "SEC. 2. Liberal Construction." }],
      WITH_HEADINGS,
    );

    assert.equal(result.grounded, 1);
    assert.equal(result.rate, 1);
  });

  test("counts a heading the document does not contain as ungrounded", () => {
    const result = scoreSectioning(
      [{ heading: "Appropriations and Transfers" }],
      WITH_HEADINGS,
    );

    assert.equal(result.grounded, 0);
    assert.equal(result.rate, 0);
  });

  test("matches across wrapped whitespace and case", () => {
    // Headings wrap in extracted PDF text; a heading is the same heading.
    const result = scoreSectioning(
      [{ heading: "section 1.   findings and\n declarations." }],
      WITH_HEADINGS,
    );

    assert.equal(result.grounded, 1);
  });

  test("reports a rate of 1 when no sections were emitted, and counts zero", () => {
    // No sections is an absence to be read off `sections`, not a grounding
    // failure to be averaged into the rate.
    const result = scoreSectioning([], WITH_HEADINGS);

    assert.equal(result.sections, 0);
    assert.equal(result.rate, 1);
  });

  test("ignores blank and non-string headings rather than scoring them", () => {
    const result = scoreSectioning(
      [
        { heading: "SEC. 3. Severability." },
        { heading: "   " },
        { heading: undefined as unknown as string },
      ],
      WITH_HEADINGS,
    );

    assert.equal(result.sections, 1);
    assert.equal(result.grounded, 1);
  });
});

describe("the prompt's own example, copied instead of read", () => {
  // 51 of 71 measures came back with exactly this pair on 2026-10-12, and most
  // of their texts contain neither phrase. A rate alone says "worse"; this
  // says why.
  test("flags the emitted list when it is the example and nothing else", () => {
    const result = scoreSectioning(COPIED, WITHOUT_HEADINGS);

    assert.equal(result.looksCopiedFromExample, true);
    assert.equal(result.exampleEchoes.length, 2);
    assert.equal(result.grounded, 0);
  });

  test("does NOT flag a single example-shaped heading the document really has", () => {
    // "Findings and Declarations" is a real section name. One of them, on a
    // measure whose text contains it, is a correct answer — not a copy.
    const result = scoreSectioning(
      [{ heading: "SECTION 1. Findings and Declarations." }],
      WITH_HEADINGS,
    );

    assert.equal(result.looksCopiedFromExample, false);
    assert.equal(result.grounded, 1);
  });

  test("does NOT penalise the example pair when the document genuinely contains both", () => {
    const both = `${WITH_HEADINGS}\nFindings and Declarations\nOperative Provisions`;
    const result = scoreSectioning(COPIED, both);

    // Still reported as echoes — the headings ARE the example's — but both are
    // grounded, so the rate does not penalise a correct answer.
    assert.equal(result.grounded, 2);
    assert.equal(result.rate, 1);
  });
});

describe("sourceHasHeadings, so a compliant synthetic heading is not a defect", () => {
  test("is true for a measure drafted with section headings", () => {
    assert.equal(scoreSectioning([], WITH_HEADINGS).sourceHasHeadings, true);
  });

  test("is false for continuous prose with none", () => {
    // The prompt permits an invented heading here, so a 0% rate on this
    // document is compliance, not a failure. Conflating the two would
    // penalise the right answer.
    assert.equal(
      scoreSectioning([], WITHOUT_HEADINGS).sourceHasHeadings,
      false,
    );
  });

  test("is false for a cross-reference, which is a citation and not a heading", () => {
    // The corpus is full of these. Counting them called 121 of 125 live
    // measures sectioned, against 104 for the stricter rule.
    const citation =
      "This measure complies with the requirements of Article XIIIA, " +
      "Section 1(b)(3), of the State Constitution.";

    assert.equal(scoreSectioning([], citation).sourceHasHeadings, false);
  });

  test("is true for a numbered label inside flowed, newline-free text", () => {
    // Production stores `full_text` with no newlines, so this is the shape
    // that actually has to match.
    const flowed =
      "The Board of Supervisors ordains as follows: Section 1. TITLE. " +
      "This ordinance shall be known as the Parks Measure.";

    assert.equal(scoreSectioning([], flowed).sourceHasHeadings, true);
  });
});
