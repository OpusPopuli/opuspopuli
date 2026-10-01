import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isGrounded,
  warrantFor,
  containmentSimilarity,
  scoreField,
  summarisePage,
  type EmittedItem,
  type GoldCivicsField,
  type Similarity,
} from "./civics.js";

/**
 * The cases here are the real ones from 2026-09-24/25, because a scorer that
 * cannot separate them is the reason four syncs produced no verdict:
 *
 *   qwen on teachers-and-students   invented 15,566 bytes from a page of links
 *   qwen on failed-qualify          claimed types and stages absent from the page
 *   nemotron on failed-qualify      returned nothing from a page dense with facts
 *
 * Similarity is injected, so none of this needs a model or an embedder.
 */

/** Exact-match-only similarity: 1.0 when normalised texts are equal. */
const exact =
  (gold: string[], emitted: string[]): Similarity =>
  (gi, ei) =>
    gold[gi].toLowerCase() === emitted[ei].toLowerCase() ? 1 : 0;

const SOURCE =
  "have failed to gather the required number of signatures during the circulation period. " +
  "Signatures Required: 546,651. Failed 07/14/2026 (PDF). INITIATIVE STATUTE.";

describe("isGrounded", () => {
  test("accepts a verbatim copy, ignoring whitespace shape", () => {
    assert.equal(isGrounded("Signatures   Required: 546,651", SOURCE), true);
  });

  test("rejects a claim that is not in the source", () => {
    // The actual qwen failure: a measure type absent from the page it came from.
    assert.equal(isGrounded("Recall", SOURCE), false);
    assert.equal(isGrounded("Final Random Sample Count", SOURCE), false);
  });

  test("rejects a stub too short to be evidence", () => {
    assert.equal(isGrounded("of", SOURCE), false);
  });

  test("does not accept a paraphrase — that is recall's job, not grounding's", () => {
    assert.equal(
      isGrounded("proponents collect signatures while circulating", SOURCE),
      false,
    );
  });
});

/**
 * The correction that invalidated this scorer's first run. The CA Secretary of
 * State source instructs "Initiative Statute, Initiative Constitutional
 * Amendment, Referendum, Recall" outright, so scoring "Recall" as a fabrication
 * penalised the model for obeying its config — and rewarded one that ignored it.
 */
describe("warrantFor", () => {
  const HINTS =
    "measureTypes here are DIRECT-DEMOCRACY measures — Initiative Statute, " +
    "Initiative Constitutional Amendment, Referendum, Recall";

  test("page text warrants a claim", () => {
    assert.equal(warrantFor("INITIATIVE STATUTE", SOURCE, HINTS), "page");
  });

  test("hints warrant a claim the page never mentions", () => {
    assert.equal(warrantFor("Recall", SOURCE, HINTS), "hint");
  });

  test("page wins when both would warrant, so the split stays meaningful", () => {
    assert.equal(warrantFor("Initiative Statute", SOURCE, HINTS), "page");
  });

  /**
   * The false positives that made the instrument the larger error term. Both
   * were scored as fabrications by strict substring matching; neither is one.
   */
  test("tolerates added or dropped function words", () => {
    // Model said "Qualified for Ballot"; the page says "qualified for the ballot".
    assert.equal(
      warrantFor(
        "Qualified for Ballot",
        "measures will become qualified for the ballot on the 131st day",
      ),
      "page",
    );
  });

  test("tolerates a reordered paraphrase only when every content word is present", () => {
    const page =
      "An eligible initiative measure is one in which the required number of " +
      "signatures have been submitted to and verified by the county elections officials.";
    assert.equal(
      warrantFor("eligible initiative measure signatures verified", page),
      "page",
    );
    // A content word the page never uses still fails — this is not synonymy.
    assert.equal(
      warrantFor("eligible initiative measure notarized", page),
      null,
    );
  });

  test("rejects tokens gathered from opposite ends of a page", () => {
    // The real case: qwen emitted "Assembly Bill" as a measure type on a page of
    // links. Both words appear — far apart, in unrelated sentences — and a
    // set-membership check warranted it. Adjacency is what makes it a quote.
    const page =
      "California State Assembly This brief color pamphlet outlines the " +
      "Assembly's organizational structure. Legislative Process How your idea " +
      "becomes a bill and the law making process.";

    assert.equal(warrantFor("Assembly Bill", page), null);
    // The page has `bill` BEFORE `assembly`, which is what makes this not a
    // quote from it. Order is the discriminator, not mere co-occurrence.
    assert.equal(warrantFor("bill law making", page), "page");
    // But the real phrase, present as a phrase, still warrants.
    assert.equal(warrantFor("organizational structure", page), "page");
  });

  test("still rejects a fabrication that shares only function words", () => {
    assert.equal(warrantFor("Recall of the Governor", SOURCE), null);
  });

  test("neither is a fabrication", () => {
    assert.equal(warrantFor("Final Random Sample Count", SOURCE, HINTS), null);
  });

  test("hints warrant only a LITERAL match, not an in-order coincidence", () => {
    // The Assembly source really contains this sentence, and a lenient rule read
    // "Assembly ... bill" out of it to excuse an invented measure type.
    const prose =
      "Seed page is the canonical CA Assembly description of how a bill " +
      "becomes law; sibling pages include the glossary";

    assert.equal(warrantFor("Assembly Bill", "", prose), null);
    // A type the config names outright still warrants.
    assert.equal(warrantFor("glossary", "", prose), "hint");
  });

  test("without hints the old behaviour is unchanged", () => {
    assert.equal(warrantFor("Recall", SOURCE), null);
  });
});

/**
 * The recall matcher's own regression. Prompt v4 looked like a 0.50 -> 0.75 gain on
 * `qualified-ballot-measures`; it was one function word. v3 emitted "Qualified for
 * Ballot" and v4 "Qualified for the Ballot", and a whitespace-only containment check
 * scored those 0 and 0.8 — across the 0.6 threshold — while the model's stage list was
 * byte-identical. Both directions are pinned so the article cannot matter again.
 */
describe("containmentSimilarity", () => {
  const GOLD =
    "Qualified for the ballot — becomes qualified on the 131st day before the general election";

  test("an article does not decide whether a label matches", () => {
    const withThe = containmentSimilarity([GOLD], ["Qualified for the Ballot"]);
    const without = containmentSimilarity([GOLD], ["Qualified for Ballot"]);
    assert.equal(withThe(0, 0), without(0, 0));
    assert.ok(
      without(0, 0) >= 0.8,
      "a label contained in the gold description matches",
    );
  });

  test("equal content tokens are an exact match despite case and function words", () => {
    const sim = containmentSimilarity(
      ["Circulation period"],
      ["the circulation PERIOD"],
    );
    assert.equal(sim(0, 0), 1);
  });

  test("a label matches a gold description that punctuates right after it", () => {
    // The false negative the content-token switch introduced: gold tokenised
    // "statute," and the emitted label "statute", so recall on a field that was
    // 1.00 silently became 0.
    const sim = containmentSimilarity(
      [
        "Initiative Statute, requiring 546,651 signatures",
        "Initiative Constitutional Amendment, requiring 874,641 signatures",
      ],
      ["Initiative Statute", "Initiative Constitutional Amendment"],
    );
    assert.ok(sim(0, 0) >= 0.8);
    assert.ok(sim(1, 1) >= 0.8);
    // And it does not blur the two types together.
    assert.equal(sim(0, 1), 0);
  });

  test("punctuation inside a token is preserved, so figures stay distinct", () => {
    const sim = containmentSimilarity(
      ["Signatures Required: 546,651"],
      ["Signatures Required: 874,641"],
    );
    assert.equal(sim(0, 0), 0);
  });

  test("a different stage name still does not match — no stemming, by choice", () => {
    // "Signature Gathering" is the region hint's example id; the page says
    // "circulation period ... proponents gather signatures". Crediting one for the
    // other is exactly how a recitation of the config would pass as a reading.
    const sim = containmentSimilarity(
      ["Circulation period — proponents gather signatures"],
      ["Signature Gathering"],
    );
    assert.equal(sim(0, 0), 0);
  });

  test("the gold's NAME matching is enough, scored below a full match", () => {
    // Real case from the held-out Senate page: the model emitted the page's own
    // section heading, which names the stage and buries it in advice-shaped prose.
    const sim = containmentSimilarity(
      [
        "Policy committee — assigned by the Rules Committee, not heard until 30 days after introduction",
      ],
      ["What To Do When Your Bill Goes To Policy Committee"],
    );
    assert.equal(sim(0, 0), 0.7);
  });

  test("a ONE-WORD gold name is never credited by a sentence mentioning it", () => {
    // "Governor" would otherwise match every heading and sentence on the page that
    // mentions the Governor at all, which is not evidence the stage was named.
    const sim = containmentSimilarity(
      ["Governor — 12 days to sign, approve without signing, or veto"],
      [
        "You Can Still Act After Your Bill Goes To The Governor",
        "The Governor has 12 days to sign, approve without signing, or veto a bill",
      ],
    );
    assert.equal(sim(0, 0), 0);
    // The real sentence still matches, on its own content, not on the head rule.
    assert.ok(sim(0, 1) >= 0.7);
  });

  test("the head rule does not credit a DIFFERENT stage with a shared word", () => {
    const sim = containmentSimilarity(
      ["Fiscal committee — heard in Senate or Assembly Appropriations"],
      ["What To Do When Your Bill Goes To Policy Committee"],
    );
    assert.equal(sim(0, 0), 0);
  });

  test("an unrelated emission scores 0, and an empty one cannot match", () => {
    const sim = containmentSimilarity([GOLD], ["General Election Vote", ""]);
    assert.equal(sim(0, 0), 0);
    assert.equal(sim(0, 1), 0);
  });
});

describe("scoreField", () => {
  const gold: GoldCivicsField = {
    expected: "non-empty",
    items: [
      { id: "a", text: "Initiative Statute", essential: true },
      { id: "b", text: "Circulation period", essential: false },
    ],
  };

  test("an empty answer on a gold-bearing field is wentEmpty, not 0% precision", () => {
    // nemotron's actual behaviour on failed-qualify. Precision must be
    // UNDEFINED — there is nothing emitted to be wrong about — while the miss
    // is recorded loudly.
    const s = scoreField("measureTypes", gold, [], SOURCE, () => 0, 0.6);

    assert.equal(s.wentEmpty, true);
    assert.equal(s.recall, 0);
    assert.equal(s.precision, undefined);
    assert.equal(s.invented, 0);
  });

  test("scores recall by similarity and precision by grounding, separately", () => {
    const emitted: EmittedItem[] = [
      { verbatim: "INITIATIVE STATUTE" }, // in the source, matches gold "a"
      { verbatim: "Recall" }, // NOT in the source -> ungrounded
    ];
    const sim = exact(
      gold.items!.map((i) => i.text),
      emitted.map((e) => e.verbatim),
    );
    const s = scoreField("measureTypes", gold, emitted, SOURCE, sim, 0.6);

    assert.equal(s.recall, 0.5); // found 1 of 2 gold items
    assert.equal(s.precision, 0.5); // 1 of 2 emitted claims grounded
    assert.deepEqual(s.ungrounded, ["Recall"]);
    assert.equal(s.wentEmpty, false);
  });

  test("essentialRecall is reported apart from overall recall", () => {
    const emitted: EmittedItem[] = [{ verbatim: "Circulation period" }];
    const sim = exact(
      gold.items!.map((i) => i.text),
      emitted.map((e) => e.verbatim),
    );
    const s = scoreField("measureTypes", gold, emitted, SOURCE, sim, 0.6);

    // Found the non-essential one and missed the essential one: the same 50%
    // recall, but a materially worse result.
    assert.equal(s.recall, 0.5);
    assert.equal(s.essentialRecall, 0);
  });

  test("counts invention on a field whose correct answer is empty", () => {
    // teachers-and-students: every field expects empty, and qwen filled them.
    const empty: GoldCivicsField = { expected: "empty", trap: true };
    const s = scoreField(
      "glossary",
      empty,
      [{ verbatim: "Assembly Bill" }, { verbatim: "Senate Bill" }],
      SOURCE,
      () => 0,
      0.6,
    );

    assert.equal(s.invented, 2);
    assert.equal(s.wentEmpty, false);
    assert.equal(s.recall, undefined); // nothing to recall
  });

  test("a correct abstention on an empty-expected field is clean", () => {
    const empty: GoldCivicsField = { expected: "empty", trap: true };
    const s = scoreField("glossary", empty, [], SOURCE, () => 0, 0.6);

    assert.equal(s.invented, 0);
    assert.equal(s.wentEmpty, false);
    assert.deepEqual(s.ungrounded, []);
  });
});

describe("scoreField with hints", () => {
  test("a hint-warranted claim counts as precise, and is reported as hint-warranted", () => {
    const gold: GoldCivicsField = {
      expected: "non-empty",
      items: [{ id: "a", text: "Initiative Statute", essential: true }],
    };
    const s = scoreField(
      "measureTypes",
      gold,
      [{ verbatim: "INITIATIVE STATUTE" }, { verbatim: "Recall" }],
      SOURCE,
      () => 0,
      0.6,
      "direct-democracy measures: Initiative Statute, Referendum, Recall",
    );

    assert.deepEqual(s.ungrounded, []); // Recall is instructed, not invented
    assert.equal(s.precision, 1);
    assert.equal(s.warrantedByPage, 1);
    assert.equal(s.warrantedByHint, 1);
  });
});

describe("the emitted-claim record", () => {
  test("records every emitted claim with its warrant, not just the failures", () => {
    // A recall-0 field with items emitted is ambiguous from the score alone. The
    // warrant per claim is what separates "paraphrased the page" from "recited
    // the config's example ids".
    const gold: GoldCivicsField = {
      expected: "non-empty",
      items: [{ id: "a", text: "Initiative Statute", essential: true }],
    };
    const s = scoreField(
      "measureTypes",
      gold,
      [
        { verbatim: "INITIATIVE STATUTE" },
        { verbatim: "Recall" },
        { verbatim: "Zoning" },
      ],
      SOURCE,
      () => 0,
      0.6,
      "direct-democracy measures: Initiative Statute, Referendum, Recall",
    );

    assert.deepEqual(s.emitted, [
      { verbatim: "INITIATIVE STATUTE", warrant: "page" },
      { verbatim: "Recall", warrant: "hint" },
      { verbatim: "Zoning", warrant: null },
    ]);
    // And it stays consistent with the counts derived from it.
    assert.equal(s.warrantedByPage, 1);
    assert.equal(s.warrantedByHint, 1);
    assert.deepEqual(s.ungrounded, ["Zoning"]);
  });
});

describe("pageOnly fields", () => {
  const HINTS =
    "the status pages describe eligibility ('eligible', 'qualified for the ballot'); " +
    "the failure pages describe terminal outcomes ('failed', 'withdrawn by proponents')";
  const gold: GoldCivicsField = {
    expected: "non-empty",
    pageOnly: true,
    items: [{ id: "a", text: "Circulation period", essential: true }],
  };

  test("a hint-only claim is an off-page error, not a pass", () => {
    // The real case: with the rewritten SoS hint, failed-qualify emitted
    // "eligible" and "qualified for the ballot" — stages that page never
    // mentions, taken from the hint's description of a DIFFERENT page.
    const s = scoreField(
      "lifecycleStages",
      gold,
      [
        { verbatim: "Circulation period" },
        { verbatim: "qualified for the ballot" },
      ],
      "proponents gather signatures during the circulation period",
      () => 0,
      0.6,
      HINTS,
    );

    assert.deepEqual(s.offPage, ["qualified for the ballot"]);
    assert.equal(s.precision, 0.5, "the hint does not excuse it here");
    assert.deepEqual(s.ungrounded, [], "it is not an invention either");
    assert.equal(s.warrantedByHint, 1, "still reported as hint-warranted");
  });

  test("without pageOnly the same claim is config compliance", () => {
    // measureTypes IS a region-level vocabulary: California instructs that
    // `Recall` is one of its ballot-measure types, so emitting it is obedience.
    const s = scoreField(
      "lifecycleStages",
      { ...gold, pageOnly: false },
      [
        { verbatim: "Circulation period" },
        { verbatim: "qualified for the ballot" },
      ],
      "proponents gather signatures during the circulation period",
      () => 0,
      0.6,
      HINTS,
    );

    assert.deepEqual(s.offPage, []);
    assert.equal(s.precision, 1);
  });

  test("an invention is still an invention on a pageOnly field", () => {
    const s = scoreField(
      "lifecycleStages",
      gold,
      [{ verbatim: "Ratified by the Governor" }],
      "proponents gather signatures during the circulation period",
      () => 0,
      0.6,
      HINTS,
    );

    assert.deepEqual(s.ungrounded, ["Ratified by the Governor"]);
    assert.deepEqual(s.offPage, []);
    assert.equal(s.precision, 0);
  });
});

describe("summarisePage", () => {
  test("names emptied and invented fields rather than averaging them away", () => {
    const gold: GoldCivicsField = {
      expected: "non-empty",
      items: [{ id: "a", text: "Initiative Statute", essential: true }],
    };
    const emptyGold: GoldCivicsField = { expected: "empty", trap: true };

    const verdict = summarisePage([
      scoreField("measureTypes", gold, [], SOURCE, () => 0, 0.6),
      scoreField(
        "glossary",
        emptyGold,
        [{ verbatim: "Recall" }],
        SOURCE,
        () => 0,
        0.6,
      ),
    ]);

    assert.deepEqual(verdict.emptied, ["measureTypes"]);
    assert.deepEqual(verdict.invented, ["glossary"]);
    assert.equal(verdict.ungroundedCount, 1);
  });

  test("the two failure shapes are distinguishable, which one score cannot do", () => {
    const gold: GoldCivicsField = {
      expected: "non-empty",
      items: [
        { id: "a", text: "Initiative Statute", essential: true },
        { id: "b", text: "Circulation period" },
      ],
    };
    // Candidate 1 finds nothing. Candidate 2 finds everything and invents two.
    const silent = summarisePage([
      scoreField("measureTypes", gold, [], SOURCE, () => 0, 0.6),
    ]);
    const loud = summarisePage([
      scoreField(
        "measureTypes",
        gold,
        [
          { verbatim: "INITIATIVE STATUTE" },
          { verbatim: "circulation period" },
          { verbatim: "Recall" },
          { verbatim: "ELIGIBLE" },
        ],
        SOURCE,
        exact(
          ["Initiative Statute", "Circulation period"],
          ["INITIATIVE STATUTE", "circulation period", "Recall", "ELIGIBLE"],
        ),
        0.6,
      ),
    ]);

    assert.equal(silent.meanRecall, 0);
    assert.equal(silent.ungroundedCount, 0); // nothing invented
    assert.equal(loud.meanRecall, 1);
    assert.equal(loud.ungroundedCount, 2); // but two fabrications
  });
});
