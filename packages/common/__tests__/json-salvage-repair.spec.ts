import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractJsonObjectSlice,
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
