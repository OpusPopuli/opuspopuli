import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  scoreAnchoring,
  detectPartitioning,
  supportRatio,
  type EmittedClaim,
} from "./anchoring.js";

/**
 * A short stand-in for a measure. Real fullText is thousands of characters;
 * what these tests exercise is the rule, so the document is small enough to
 * reason about offset by offset.
 */
const FULL_TEXT = [
  "The People of the State of California do enact as follows.",
  "Section 1. Every public school shall provide instruction in earth sustainability.",
  "Section 2. The Superintendent shall appropriate funds for teacher training.",
].join("\n");

describe("supportRatio", () => {
  test("is high when the span carries the claim's vocabulary", () => {
    const r = supportRatio(
      "schools must provide sustainability instruction",
      "Every public school shall provide instruction in earth sustainability.",
    );
    assert.ok(r > 0.5, `expected > 0.5, got ${r}`);
  });

  test("is low when the span is unrelated to the claim", () => {
    const r = supportRatio(
      "schools must provide sustainability instruction",
      "The People of the State of California do enact as follows.",
    );
    assert.ok(r < 0.3, `expected < 0.3, got ${r}`);
  });

  test("is 0 for a claim with no content words", () => {
    assert.equal(supportRatio("it is the", "anything"), 0);
  });
});

describe("detectPartitioning", () => {
  test("flags qwen's consecutive abutting spans", () => {
    // Verbatim shape from #1142: 260..580, 580..850, 850..1300 — the model is
    // cutting the document into pieces, not locating text in it.
    const claims: EmittedClaim[] = [
      { claim: "a", field: "x", sourceStart: 260, sourceEnd: 580 },
      { claim: "b", field: "x", sourceStart: 580, sourceEnd: 850 },
      { claim: "c", field: "x", sourceStart: 850, sourceEnd: 1300 },
    ];
    assert.equal(detectPartitioning(claims), true);
  });

  test("does not flag spans that merely sit near each other", () => {
    const claims: EmittedClaim[] = [
      { claim: "a", field: "x", sourceStart: 10, sourceEnd: 50 },
      { claim: "b", field: "x", sourceStart: 90, sourceEnd: 140 },
      { claim: "c", field: "x", sourceStart: 200, sourceEnd: 260 },
    ];
    assert.equal(detectPartitioning(claims), false);
  });

  test("needs three consecutive spans, not two", () => {
    const claims: EmittedClaim[] = [
      { claim: "a", field: "x", sourceStart: 10, sourceEnd: 50 },
      { claim: "b", field: "x", sourceStart: 50, sourceEnd: 90 },
    ];
    assert.equal(detectPartitioning(claims), false);
  });
});

describe("scoreAnchoring — offsets contract", () => {
  test("anchors a claim whose span genuinely supports it", () => {
    const start = FULL_TEXT.indexOf("Every public school");
    const end = FULL_TEXT.indexOf("sustainability.") + "sustainability.".length;
    const score = scoreAnchoring(
      [
        {
          claim: "public schools must provide earth sustainability instruction",
          field: "keyProvisions",
          sourceStart: start,
          sourceEnd: end,
        },
      ],
      FULL_TEXT,
    );
    assert.equal(score.anchored, 1);
    assert.equal(score.results[0].verdict, "anchored");
  });

  test("reports granite's impossible offsets as out-of-range, not clamped", () => {
    // 1240..5400 in a document far shorter than 5400. normalizePayload would
    // clamp this to a plausible-looking in-range span; the scorer must not.
    const score = scoreAnchoring(
      [
        {
          claim: "anything at all",
          field: "x",
          sourceStart: 1240,
          sourceEnd: 5400,
        },
      ],
      FULL_TEXT,
    );
    assert.equal(score.results[0].verdict, "out-of-range");
    assert.equal(score.anchored, 0);
    assert.equal(score.results[0].resolved, undefined);
  });

  test("rejects an in-range span that does not support its claim", () => {
    const score = scoreAnchoring(
      [
        {
          claim: "the measure appropriates funds for teacher training",
          field: "fiscalImpact",
          sourceStart: 0,
          sourceEnd: 58, // the enacting clause — in range, unrelated
        },
      ],
      FULL_TEXT,
    );
    assert.equal(score.results[0].verdict, "unsupported");
    assert.equal(score.anchored, 0);
  });

  test("rejects a reversed or empty span", () => {
    const score = scoreAnchoring(
      [{ claim: "x y z", field: "x", sourceStart: 100, sourceEnd: 100 }],
      FULL_TEXT,
    );
    assert.equal(score.results[0].verdict, "empty-span");
  });

  test("reports a claim with no offsets at all", () => {
    const score = scoreAnchoring([{ claim: "x y z", field: "x" }], FULL_TEXT);
    assert.equal(score.results[0].verdict, "missing-anchor");
  });

  test("records span length so a half-document citation is visible", () => {
    const score = scoreAnchoring(
      [
        {
          claim: "school instruction sustainability provide",
          field: "x",
          sourceStart: 0,
          sourceEnd: FULL_TEXT.length,
        },
      ],
      FULL_TEXT,
    );
    assert.equal(score.results[0].spanChars, FULL_TEXT.length);
  });

  test("scores zero claims as 0, not as a perfect score", () => {
    // A model that cites nothing has anchored nothing. Reporting 1.0 would
    // rank it above one that tried and partly succeeded.
    const score = scoreAnchoring([], FULL_TEXT);
    assert.equal(score.rate, 0);
    assert.equal(score.total, 0);
  });
});

describe("scoreAnchoring — quote-then-locate contract (#1212)", () => {
  test("locates a verbatim quote and anchors it", () => {
    const score = scoreAnchoring(
      [
        {
          claim: "public schools must provide sustainability instruction",
          field: "keyProvisions",
          sourceQuote:
            "Every public school shall provide instruction in earth sustainability.",
        },
      ],
      FULL_TEXT,
      "quote-then-locate",
    );
    assert.equal(score.results[0].verdict, "anchored");
    assert.ok(score.results[0].resolved);
  });

  test("tolerates reflowed whitespace in the quote", () => {
    // A model that rewraps a line has not miscited anything.
    const score = scoreAnchoring(
      [
        {
          claim: "public schools must provide sustainability instruction",
          field: "x",
          sourceQuote:
            "Every public school shall provide\n  instruction in earth sustainability.",
        },
      ],
      FULL_TEXT,
      "quote-then-locate",
    );
    assert.equal(score.results[0].verdict, "anchored");
  });

  // Regression guard for the defect this contract shipped with: the scorer
  // read `claim.quote` while the prompt template emits `sourceQuote`, and
  // `generation-eval` casts model output straight to EmittedClaim with no
  // field mapping. Every claim therefore scored `missing-anchor` and the S2
  // gate could only ever report 0% — indistinguishable from "models cannot
  // quote either", and the one result that would wrongly force the
  // segment-id fallback.
  //
  // Parsed from JSON on purpose. A typed object literal would be updated by
  // the compiler if the interface field were renamed again, hiding exactly
  // the mismatch this test exists to catch; parsed JSON is `any`, so it keeps
  // asserting against the wire shape the template actually produces.
  test("reads the field name the prompt template actually emits", () => {
    const asModelEmitsIt = JSON.parse(
      JSON.stringify({
        claim: "public schools must provide sustainability instruction",
        field: "keyProvisions",
        sourceQuote:
          "Every public school shall provide instruction in earth sustainability.",
        confidence: "high",
      }),
    ) as EmittedClaim;

    const score = scoreAnchoring(
      [asModelEmitsIt],
      FULL_TEXT,
      "quote-then-locate",
    );

    assert.equal(
      score.byVerdict["missing-anchor"],
      undefined,
      "a well-formed quoted claim must not score missing-anchor — that verdict " +
        "means the scorer is reading a field the producer never sets",
    );
    assert.equal(score.results[0].verdict, "anchored");
    assert.equal(score.rate, 1);
  });

  test("flags an all-missing-anchor run as a probable field mismatch", () => {
    // The whole failure mode in one assertion: claims that carry no anchor
    // field at all. Reporting 0% silently is indistinguishable from "the
    // model cannot quote", so the score must say the measurement is suspect.
    const score = scoreAnchoring(
      [
        { claim: "a", field: "x" },
        { claim: "b", field: "y" },
      ],
      FULL_TEXT,
      "quote-then-locate",
    );
    assert.equal(score.rate, 0);
    assert.equal(score.looksUnmapped, true);
  });

  test("does not flag a run where some claims did anchor", () => {
    const score = scoreAnchoring(
      [
        {
          claim: "public schools must provide sustainability instruction",
          field: "keyProvisions",
          sourceQuote:
            "Every public school shall provide instruction in earth sustainability.",
        },
        { claim: "b", field: "y" },
      ],
      FULL_TEXT,
      "quote-then-locate",
    );
    assert.equal(score.looksUnmapped, false);
  });

  test("reports a quote that is not in the source", () => {
    const score = scoreAnchoring(
      [
        {
          claim: "the measure bans homework",
          field: "x",
          sourceQuote: "All homework is hereby abolished.",
        },
      ],
      FULL_TEXT,
      "quote-then-locate",
    );
    assert.equal(score.results[0].verdict, "quote-not-found");
  });

  test("does not run the partitioning check on this contract", () => {
    // There are no offsets to partition; reporting true would be meaningless.
    const score = scoreAnchoring(
      [{ claim: "a", field: "x", sourceQuote: "Section 1." }],
      FULL_TEXT,
      "quote-then-locate",
    );
    assert.equal(score.looksPartitioned, false);
  });
});
