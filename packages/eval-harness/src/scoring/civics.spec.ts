import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isGrounded,
  warrantFor,
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

  test("neither is a fabrication", () => {
    assert.equal(warrantFor("Final Random Sample Count", SOURCE, HINTS), null);
  });

  test("without hints the old behaviour is unchanged", () => {
    assert.equal(warrantFor("Recall", SOURCE), null);
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
