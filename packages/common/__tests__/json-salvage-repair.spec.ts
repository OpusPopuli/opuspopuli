import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractJsonObjectSlice,
  repairTrailingCommas,
  repairUnescapedQuotes,
} from "../src/utils/json-salvage.js";

/**
 * Regression for the 2026-10-06 civics sync, where the SoS referendum page
 * produced 22,162 characters of correct extraction and was discarded whole.
 *
 * The page says `referred to as a "full check."`; the model reproduced those
 * inner quotes unescaped inside a `verbatim` field, which desynchronises the
 * brace scan in `extractJsonObjectSlice`, so no balanced object is found and
 * the pipeline marks the page `failed`.
 *
 * The fixture below is that exact shape. Verified by reintroducing the bug:
 * drop the `repairUnescapedQuotes` call from the "recovers" case and it fails
 * with `undefined`, which is what the pipeline saw.
 */
const BROKEN = `{
  "measureTypes": [
    {
      "code": "Referendum",
      "purpose": {
        "verbatim": "the SOS notifies county elections officials to verify every signature on the petition. This process is referred to as a "full check."",
        "plainLanguage": "Every signature gets checked."
      }
    }
  ],
  "sessionScheme": null,
  "glossary": []
}`;

describe("repairUnescapedQuotes", () => {
  it("leaves valid JSON untouched", () => {
    const valid = '{"a": "plain", "b": ["x", "y"], "c": null}';
    expect(repairUnescapedQuotes(valid)).toBe(valid);
    expect(JSON.parse(repairUnescapedQuotes(valid))).toEqual({
      a: "plain",
      b: ["x", "y"],
      c: null,
    });
  });

  it("is idempotent — repairing twice changes nothing further", () => {
    const once = repairUnescapedQuotes(BROKEN);
    expect(repairUnescapedQuotes(once)).toBe(once);
  });

  it("preserves already-escaped quotes rather than double-escaping them", () => {
    const ok = '{"v": "a \\"quoted\\" term", "n": 1}';
    expect(repairUnescapedQuotes(ok)).toBe(ok);
    expect(JSON.parse(repairUnescapedQuotes(ok)).v).toBe('a "quoted" term');
  });

  it("the pipeline's own path returns a slice that will not parse", () => {
    // What the sync actually saw, corrected after measuring it: the brace scan
    // DOES find a balanced object — the stray quote does not desynchronise it,
    // because the quote that follows re-balances the string state. The failure
    // is at JSON.parse, which is the third failure class civics-sync.service.ts
    // documents and captures.
    const slice = extractJsonObjectSlice(BROKEN);
    expect(slice).toBeDefined();
    expect(() => JSON.parse(slice!)).toThrow();
  });

  it("recovers the whole object once repaired, with the quotes intact as content", () => {
    const slice = extractJsonObjectSlice(repairUnescapedQuotes(BROKEN));
    expect(slice).toBeDefined();
    const parsed = JSON.parse(slice!);
    expect(parsed.measureTypes[0].code).toBe("Referendum");
    // the inner quotes survive as DATA, not as structure
    expect(parsed.measureTypes[0].purpose.verbatim).toContain('"full check."');
    expect(parsed.glossary).toEqual([]);
  });

  /**
   * There was a test here that read `tmp/civics-capture/*.response.txt`, the
   * artifact this bug was diagnosed from. It passed when written and failed
   * hours later, because capture filenames are a hash of the source URL and a
   * repeat failure on the same page OVERWRITES the file — so the test was a
   * snapshot of whatever happened to be on disk, not an assertion.
   *
   * The replacement artifact also showed a DIFFERENT malformation this repair
   * deliberately does not handle: a trailing comma before a closing brace
   * (`"...instead.",\n },`), which fails with "Expected double-quoted property
   * name". Worth fixing separately; escaping quotes is not the tool for it.
   *
   * The inline fixture above reproduces the measured shape deterministically.
   */
});

describe("repairTrailingCommas", () => {
  /**
   * The measured shape, from the SoS referendum page under civics prompt v6:
   * `Illegal trailing comma before end of object` at char 12890. It only
   * surfaced once v6 fixed the unescaped quotes that had been failing earlier
   * in the same response — the defect was always there, behind the first one.
   */
  const BROKEN = `{
  "lifecycleStages": [
    {
      "id": "qualified",
      "description": "the referendum qualifies for the following general election instead.",
    },
    {
      "id": "failed",
    }
  ],
  "glossary": [],
}`;

  it("the pipeline's own path returns a slice that will not parse", () => {
    const slice = extractJsonObjectSlice(BROKEN);
    expect(slice).toBeDefined();
    // Deliberately not matching the message. Production reported this class
    // as "Illegal trailing comma before end of object"; this fixture reports
    // "Expected double-quoted property name" for the same defect, because the
    // wording depends on what follows the comma and on the Node version.
    expect(() => JSON.parse(slice!)).toThrow();
  });

  it("recovers the object, losing no content", () => {
    const parsed = JSON.parse(repairTrailingCommas(BROKEN));
    expect(parsed.lifecycleStages).toHaveLength(2);
    expect(parsed.lifecycleStages[0].description).toContain(
      "following general election",
    );
    expect(parsed.glossary).toEqual([]);
  });

  it("leaves valid JSON untouched and is idempotent", () => {
    const valid = '{"a": [1, 2], "b": {"c": "x"}}';
    expect(repairTrailingCommas(valid)).toBe(valid);
    const once = repairTrailingCommas(BROKEN);
    expect(repairTrailingCommas(once)).toBe(once);
  });

  it("keeps a comma that is inside a string value", () => {
    // The failure a naive regex would cause: the comma here is content.
    const s = '{"v": "statutes, or parts of statutes, ]", "n": 1}';
    expect(repairTrailingCommas(s)).toBe(s);
    expect(JSON.parse(repairTrailingCommas(s)).v).toContain(
      "parts of statutes",
    );
  });

  it("handles a comma before a closing bracket, and several at once", () => {
    const parsed = JSON.parse(
      repairTrailingCommas('{"a": [1, 2, ], "b": [3, ], }'),
    );
    expect(parsed).toEqual({ a: [1, 2], b: [3] });
  });

  it("composes with the quote repair — each fixes a class the other does not", () => {
    const both = `{"v": "referred to as a "full check."", "list": [1, 2, ], }`;
    expect(() => JSON.parse(both)).toThrow();
    const fixed = repairTrailingCommas(repairUnescapedQuotes(both));
    const parsed = JSON.parse(fixed);
    expect(parsed.v).toContain('"full check."');
    expect(parsed.list).toEqual([1, 2]);
  });
});
