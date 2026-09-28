import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface GoldItem {
  id: string;
  essential: boolean;
  text: string;
  evidence?: string;
  supportingEvidence?: string;
}
interface GoldField {
  expected: "empty" | "non-empty";
  items?: GoldItem[];
  evidence?: string;
  trap?: boolean;
}
interface GoldPage {
  sourceUrl: string;
  extractedChars: number;
  extractedTextForAudit: string;
  fields: Record<string, GoldField>;
}

const gold = JSON.parse(
  readFileSync(join(ROOT, "fixtures/gold-civics.json"), "utf8"),
) as { kind: string; pages: GoldPage[] };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The gold set's whole claim is that every expectation is quotable from the text
 * the model receives. That claim is only worth something if it is checked — the
 * author is a model, and an unverified gold set is just one model's opinion
 * wearing a fixture's clothes.
 *
 * Runs offline against `extractedTextForAudit`, the text each page was authored
 * against, so it catches a typo'd or drifted quote without a network call. When a
 * page genuinely changes, refresh that text and any quote that no longer resolves
 * fails here — which is the point: silent rot becomes a red test.
 */
describe("gold-civics fixture", () => {
  test("is the expected kind and non-empty", () => {
    assert.equal(gold.kind, "civics-gold");
    assert.ok(gold.pages.length > 0);
  });

  test("every evidence quote resolves in the text it was authored against", () => {
    let checked = 0;
    for (const page of gold.pages) {
      const hay = norm(page.extractedTextForAudit);
      assert.ok(
        hay.length > 0,
        `${page.sourceUrl} has no extractedTextForAudit — the gold items cannot be verified`,
      );
      for (const [fieldName, field] of Object.entries(page.fields)) {
        const quotes = [
          field.evidence,
          ...(field.items ?? []).flatMap((i) => [
            i.evidence,
            i.supportingEvidence,
          ]),
        ].filter((q): q is string => Boolean(q));
        for (const q of quotes) {
          assert.ok(
            hay.includes(norm(q)),
            `${page.sourceUrl} [${fieldName}] quote not found in the authored text: ${JSON.stringify(q.slice(0, 80))}`,
          );
          checked += 1;
        }
      }
    }
    assert.ok(
      checked >= 18,
      `expected at least 18 verified quotes, checked ${checked}`,
    );
  });

  test("recorded char counts match the recorded text", () => {
    for (const page of gold.pages) {
      assert.equal(
        page.extractedTextForAudit.length,
        page.extractedChars,
        `${page.sourceUrl}: extractedChars disagrees with the text it records`,
      );
    }
  });

  test("item ids are unique across the whole fixture", () => {
    const ids = gold.pages.flatMap((p) =>
      Object.values(p.fields).flatMap((f) => (f.items ?? []).map((i) => i.id)),
    );
    assert.equal(new Set(ids).size, ids.length, "duplicate gold item id");
  });

  test("a non-empty field has items and an empty field has none", () => {
    for (const page of gold.pages) {
      for (const [name, field] of Object.entries(page.fields)) {
        if (field.expected === "non-empty") {
          assert.ok(
            (field.items ?? []).length > 0,
            `${page.sourceUrl} [${name}] is non-empty but lists no items`,
          );
        } else {
          assert.equal(
            (field.items ?? []).length,
            0,
            `${page.sourceUrl} [${name}] expects empty but lists items`,
          );
        }
      }
    }
  });

  /**
   * Without at least one page whose correct answer is "nothing", the eval can
   * only reward finding things — and qwen's invention on teachers-and-students
   * would score as a win while nemotron's correct abstention scored as a loss.
   */
  test("carries at least one precision trap", () => {
    const traps = gold.pages.flatMap((p) =>
      Object.values(p.fields).filter((f) => f.trap),
    );
    assert.ok(traps.length > 0, "no field marked as a precision trap");
    for (const t of traps) {
      assert.equal(t.expected, "empty", "a trap must expect an empty field");
    }
  });
});
