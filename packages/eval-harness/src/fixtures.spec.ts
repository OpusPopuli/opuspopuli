import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, p), "utf8"));

interface Item {
  id: string;
  lang: string;
  query: string;
  gold: string[];
  difficulty: string;
  contentOnly?: boolean;
  notes?: string;
}

const retrieval = read("fixtures/retrieval-propositions.json") as {
  items: Item[];
};
const corpus = read("fixtures/corpus-propositions.json") as Array<{
  externalId: string;
}>;
const corpusIds = new Set(corpus.map((d) => d.externalId));

const DIFFICULTIES = new Set([
  "direct",
  "oblique",
  "ambiguous",
  "cross-lingual",
]);

/**
 * Structural checks on the gold set.
 *
 * These exist because the failure they catch is silent: a gold id that does not
 * resolve scores as a permanent miss, and reads as a model failing rather than
 * as a typo. `rank` is computed from `indexOf`, so an unknown id yields rank 0
 * and quietly poisons MRR.
 */
describe("retrieval fixture", () => {
  test("meets the M4 floor of 50 gold items", () => {
    assert.ok(
      retrieval.items.length >= 50,
      `expected >= 50 items, got ${retrieval.items.length}`,
    );
  });

  test("every gold id resolves against the corpus", () => {
    const unresolved = retrieval.items.flatMap((i) =>
      i.gold.filter((g) => !corpusIds.has(g)).map((g) => `${i.id} -> ${g}`),
    );
    assert.deepEqual(unresolved, []);
  });

  test("item ids are unique", () => {
    const ids = retrieval.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every item has a non-empty query and at least one gold id", () => {
    for (const i of retrieval.items) {
      assert.ok(i.query.trim().length > 0, `${i.id} has an empty query`);
      assert.ok(i.gold.length > 0, `${i.id} has no gold id`);
    }
  });

  test("difficulty is within the documented enum", () => {
    for (const i of retrieval.items) {
      assert.ok(
        DIFFICULTIES.has(i.difficulty),
        `${i.id} has difficulty "${i.difficulty}"`,
      );
    }
  });

  test("holds Spanish coverage above a third of the set", () => {
    // Spanish parity is a platform non-negotiable, and an aggregate hides it.
    // A floor here stops ES coverage being diluted as EN items are added.
    const es = retrieval.items.filter((i) => i.lang === "es").length;
    assert.ok(
      es / retrieval.items.length >= 0.33,
      `ES coverage is ${es}/${retrieval.items.length}`,
    );
  });

  test("the original 22 items are unchanged", () => {
    // The #1229 baselines were recorded against these exact items. Editing one
    // silently invalidates every comparison back to that run.
    // The original set is ret-en-001..014 and ret-es-001..008. A single
    // pattern over both languages would also sweep up ret-es-009+, which are
    // new — and then pass at the wrong count.
    const original = retrieval.items.filter(
      (i) =>
        /^ret-en-0(0[1-9]|1[0-4])$/.test(i.id) || /^ret-es-00[1-8]$/.test(i.id),
    );
    assert.equal(original.length, 22);
    assert.equal(original.filter((i) => i.lang === "en").length, 14);
    assert.equal(original.filter((i) => i.lang === "es").length, 8);
  });

  test("content-only items carry a note explaining why", () => {
    // These are expected to MISS until the corpus carries real summaries.
    // Without a stated reason they read as authoring errors.
    for (const i of retrieval.items.filter((x) => x.contentOnly)) {
      assert.ok(
        (i.notes ?? "").length > 20,
        `${i.id} is contentOnly but has no explanation`,
      );
    }
  });
});

describe("symmetry fixture", () => {
  const pairs = read("fixtures/symmetry-pairs.json") as {
    pairs: Array<{
      id: string;
      control?: boolean;
      a: { externalId: string };
      b: { externalId: string };
    }>;
  };
  const sources = read("fixtures/symmetry-sources.json") as {
    items: Array<{ externalId: string }>;
  };

  test("carries exactly one control pair", () => {
    // The control is what makes the other readings interpretable. Zero of them
    // and a flagged pair means nothing; two would be ambiguous.
    assert.equal(pairs.pairs.filter((p) => p.control).length, 1);
  });

  test("every pair member has source text", () => {
    const have = new Set(sources.items.map((i) => i.externalId));
    const missing = pairs.pairs
      .flatMap((p) => [p.a.externalId, p.b.externalId])
      .filter((id) => !have.has(id));
    assert.deepEqual(missing, []);
  });
});
