import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  contentWords,
  namedIn,
  scoreCommittees,
  scoreLabelling,
  scoreList,
} from "./representatives.js";

describe("namedIn", () => {
  test("finds a committee named in a sentence, case and punctuation aside", () => {
    assert.ok(
      namedIn(
        "Water, Parks, and Wildlife",
        "She serves on the water, parks and wildlife committee.",
      ),
    );
  });

  test("does not assemble a name from words in different sentences", () => {
    // "Water" here and "Wildlife" there are not a committee anyone named.
    assert.equal(
      namedIn(
        "Water, Parks, and Wildlife",
        "She works on water policy. Parks matter. She cares about wildlife.",
      ),
      false,
    );
  });

  test("ignores the kind of committee — Select, Joint, Committee on", () => {
    assert.deepEqual(contentWords("Joint Committee on Rules"), ["rules"]);
    assert.ok(namedIn("Joint Committee on Rules", "Member of Rules."));
  });

  test("a phrase of only kind-words names nothing", () => {
    assert.equal(namedIn("Select Committee", "any committee at all"), false);
  });
});

describe("scoreCommittees", () => {
  const gold = [
    { name: "Agriculture", role: "Vice Chair" },
    { name: "Budget", role: "Member" },
    { name: "Joint Committee on Rules", role: "Member" },
  ];

  test("counts what was named and lists what was missed", () => {
    const r = scoreCommittees(
      gold,
      "Hadwick is Vice Chair of Agriculture and serves on Budget.",
    );

    assert.equal(r.found, 2);
    assert.equal(r.total, 3);
    assert.deepEqual(r.missed, ["Joint Committee on Rules"]);
  });

  test("reports a flattened role apart from a missed committee", () => {
    // The 2026-10-19 baseline: Hadwick's Vice Chair roles flattened to
    // "serves on" — the committee found, the stated role lost.
    const r = scoreCommittees(
      gold,
      "Hadwick serves on Agriculture and Budget.",
    );

    assert.equal(r.found, 2);
    assert.deepEqual(r.roles, [
      { committee: "Agriculture", role: "Vice Chair", kept: false },
    ]);
  });

  test("keeps a role stated beside its committee", () => {
    const r = scoreCommittees(gold, "She is Vice Chair of Agriculture.");

    assert.equal(r.roles[0]?.kept, true);
  });

  test("an empty summary finds nothing", () => {
    assert.equal(scoreCommittees(gold, "").found, 0);
  });
});

describe("scoreList", () => {
  test("recall over short facts", () => {
    const r = scoreList(
      ["alpine", "el dorado", "modoc"],
      "District 1 includes Alpine, El Dorado and Placer counties.",
    );

    assert.equal(r.found, 2);
    assert.deepEqual(r.missed, ["modoc"]);
  });
});

describe("scoreLabelling", () => {
  test("is not exercised without source text — never a rate over nothing", () => {
    const r = scoreLabelling([{ origin: "source", sentence: "x" }], undefined);

    assert.equal(r.exercised, false);
  });

  test("precision over source claims, labelling over unquotable ones", () => {
    const r = scoreLabelling(
      [
        { origin: "source", sentence: "She was elected in 2022." },
        { origin: "source", sentence: "She was a community organizer." },
        { origin: "training", sentence: "She grew up in Redding." },
      ],
      "Senator Ashby was elected in 2022 to represent Sacramento.",
    );

    assert.ok(r.exercised);
    if (!r.exercised) return;
    assert.equal(r.sourceClaims, 2);
    assert.equal(r.precision, 0.5);
    // Two unquotable: the organizer claim (labelled source — dishonest) and
    // the Redding claim (labelled training — honest).
    assert.equal(r.unquotable, 2);
    assert.equal(r.honestlyLabelled, 1);
  });

  test("precision is null, not 1, when nothing is marked source", () => {
    const r = scoreLabelling(
      [{ origin: "training", sentence: "Anything." }],
      "Some text.",
    );

    assert.ok(r.exercised && r.precision === null);
  });
});
