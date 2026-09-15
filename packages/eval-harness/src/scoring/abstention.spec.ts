import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isFilled, scoreAbstention } from "./abstention.js";

describe("isFilled", () => {
  test("treats real content as filled", () => {
    assert.equal(isFilled("The measure raises the cap to 5%."), true);
  });

  test("treats empty and whitespace as not filled", () => {
    assert.equal(isFilled(""), false);
    assert.equal(isFilled("   \n "), false);
    assert.equal(isFilled(undefined), false);
    assert.equal(isFilled(null), false);
  });

  test("treats non-answers as abstention, not content", () => {
    // A model writing "Not specified" has abstained. Counting it as filled
    // hands out credit for a non-answer.
    for (const v of ["N/A", "n/a", "None", "Not specified", "Unknown", "—"]) {
      assert.equal(isFilled(v), false, `expected "${v}" to read as empty`);
    }
  });

  test("checks arrays and objects structurally", () => {
    assert.equal(isFilled([]), false);
    assert.equal(isFilled(["", "  "]), false);
    assert.equal(isFilled(["a real provision"]), true);
    assert.equal(isFilled({ current: "", proposed: "" }), false);
    assert.equal(isFilled({ current: "", proposed: "a change" }), true);
  });
});

describe("scoreAbstention", () => {
  test("credits staying silent when the source cannot support the field", () => {
    // The qwen case from #1142: AG-filed initiative text carries no fiscal
    // analysis, so an empty fiscalImpact is the honest answer.
    const score = scoreAbstention(
      { analysisSummary: "A summary.", fiscalImpact: "" },
      [
        { field: "analysisSummary", supportable: true },
        {
          field: "fiscalImpact",
          supportable: false,
          rationale: "AG-filed text contains no fiscal analysis",
        },
      ],
    );
    assert.equal(score.rate, 1);
    assert.equal(score.abstained, 1);
    assert.equal(score.fabricated, 0);
  });

  test("penalises the granite fabrication that topped the old scoreboard", () => {
    // 16/18 fields, achieved by inventing the fiscal impact. Under this metric
    // that is the worst verdict available, not the best score.
    const score = scoreAbstention(
      {
        analysisSummary: "A summary.",
        fiscalImpact: "$1.2 million in new state revenue annually.",
      },
      [
        { field: "analysisSummary", supportable: true },
        { field: "fiscalImpact", supportable: false },
      ],
    );
    assert.equal(score.fabricated, 1);
    assert.equal(score.rate, 0.5);
  });

  test("ranks the abstaining model above the fabricating one", () => {
    const expectations = [
      { field: "analysisSummary", supportable: true },
      { field: "fiscalImpact", supportable: false },
    ];
    const honest = scoreAbstention(
      { analysisSummary: "A summary.", fiscalImpact: "" },
      expectations,
    );
    const fabricator = scoreAbstention(
      { analysisSummary: "A summary.", fiscalImpact: "$1.2 million." },
      expectations,
    );
    // The inversion this whole scorer exists to fix.
    assert.ok(honest.rate > fabricator.rate);
  });

  test("records a miss when the source had the answer and the model stayed silent", () => {
    const score = scoreAbstention({ analysisSummary: "" }, [
      { field: "analysisSummary", supportable: true },
    ]);
    assert.equal(score.missed, 1);
    assert.equal(score.fabricated, 0);
  });

  test("keeps fabricated and missed separate rather than netting them", () => {
    // Both are wrong; they are not equally wrong, and one accuracy number
    // would hide which happened.
    const score = scoreAbstention(
      { analysisSummary: "", fiscalImpact: "$5 million." },
      [
        { field: "analysisSummary", supportable: true },
        { field: "fiscalImpact", supportable: false },
      ],
    );
    assert.equal(score.missed, 1);
    assert.equal(score.fabricated, 1);
    assert.equal(score.rate, 0);
  });

  test("carries the fixture author's rationale onto the verdict", () => {
    const score = scoreAbstention({ fiscalImpact: "" }, [
      {
        field: "fiscalImpact",
        supportable: false,
        rationale: "no fiscal analysis in an AG-filed initiative",
      },
    ]);
    assert.match(score.results[0].rationale ?? "", /AG-filed/);
  });
});
