import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface GoldCommittee {
  name: string;
  role: string;
}
interface GoldField {
  gold: (string | GoldCommittee)[] | null;
  quote?: string;
  why?: string;
  note?: string;
}
interface GoldPage {
  rep: string;
  chamber: string;
  district: string;
  sourceUrl: string;
  contentHash: string;
  extractedChars: number;
  extractedTextForAudit: string;
  fields: Record<string, GoldField>;
}
interface Gold {
  kind: string;
  pages: GoldPage[];
  blockedBioGold: { rep: string; extractedChars: number; blockedBy: string }[];
  heldOut: { rep: string }[];
  ownerReviewRequired: string[];
}

const gold = JSON.parse(
  readFileSync(join(ROOT, "fixtures/gold-representatives.json"), "utf8"),
) as Gold;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The gold set's whole claim is that every expectation is quotable from the
 * text the model receives. That claim is worth nothing unchecked — the author
 * is a model, and an unverified gold set is one model's opinion wearing a
 * fixture's clothes (`docs/plans/representatives-gold-eval.md`, D3).
 *
 * Runs offline against `extractedTextForAudit` — the exact text each page was
 * authored against, for the pinned `contentHash` — so a typo'd or drifted
 * quote fails here without a network call. Mirrors `gold-civics.spec.ts`.
 */
describe("gold-representatives fixture", () => {
  test("every gold field with content carries a verbatim quote", () => {
    for (const page of gold.pages) {
      for (const [name, field] of Object.entries(page.fields)) {
        if (!field.gold) continue;
        assert.ok(
          field.quote,
          `${page.rep} / ${name}: has gold but no quote. D3 is quote-or-omit.`,
        );
      }
    }
  });

  test("every quote resolves verbatim in the text the model receives", () => {
    for (const page of gold.pages) {
      const text = norm(page.extractedTextForAudit);
      for (const [name, field] of Object.entries(page.fields)) {
        if (!field.quote) continue;
        assert.ok(
          text.includes(norm(field.quote)),
          `${page.rep} / ${name}: quote not found in extractedTextForAudit. ` +
            `Either the quote drifted or the page changed — refresh both.`,
        );
      }
    }
  });

  test("extractedChars matches the audit text it describes", () => {
    for (const page of gold.pages) {
      assert.equal(
        page.extractedChars,
        page.extractedTextForAudit.length,
        `${page.rep}: extractedChars disagrees with extractedTextForAudit`,
      );
    }
  });

  // A biography field asserting `gold: null` is a positive claim — "the source
  // contains none" — and is the basis of #1383. If a future page genuinely
  // gains biographical prose, this should fail so the claim is revisited
  // rather than silently outliving its evidence.
  test("pages claiming no biography carry a reason, and no quote", () => {
    for (const page of gold.pages) {
      const bio = page.fields.biography;
      if (!bio) continue;
      assert.equal(bio.gold, null, `${page.rep}: biography gold unexpected`);
      assert.ok(bio.why, `${page.rep}: biography:null must say why`);
      assert.ok(
        !bio.quote,
        `${page.rep}: an absent biography cannot have a quote`,
      );
    }
  });

  test("blocked pages name the issue blocking them", () => {
    assert.ok(gold.blockedBioGold.length > 0);
    for (const b of gold.blockedBioGold) {
      assert.match(
        b.blockedBy,
        /^#\d+$/,
        `${b.rep}: blockedBy must reference an issue`,
      );
    }
  });

  // D6: the held-out pair exists to catch tuning that only fits the tuning
  // set. A held-out rep appearing in `pages` would silently destroy that.
  test("held-out reps are absent from the scored pages", () => {
    const scored = new Set(gold.pages.map((p) => p.rep));
    for (const h of gold.heldOut) {
      assert.ok(
        !scored.has(h.rep),
        `${h.rep} is held out but appears in pages — D6 violated`,
      );
    }
  });

  test("the fixture still asks for a countersignature", () => {
    assert.ok(
      gold.ownerReviewRequired.length > 0,
      "a model-authored gold set must keep its review requirement visible",
    );
  });
});
