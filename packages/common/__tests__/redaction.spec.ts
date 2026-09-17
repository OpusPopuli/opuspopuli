import {
  redactContactDetails,
  findContactDetails,
} from "../src/utils/redaction";
import { locateQuote } from "../src/utils/quote-locator";

// Thin shims so the assertions read the same after the move from the harness's
// node:test runner to common's jest runner (opuspopuli#1212 S3).
const expectEqual = (a: unknown, b: unknown, _msg?: string): void => {
  expect(a).toBe(b);
};
const expectDeepEqual = (a: unknown, b: unknown, _msg?: string): void => {
  expect(a).toEqual(b);
};
const expectMatch = (a: string, re: RegExp, _msg?: string): void => {
  expect(a).toMatch(re);
};
const expectOk = (a: unknown, _msg?: string): void => {
  expect(a).toBeTruthy();
};

describe("redactContactDetails", () => {
  test("removes an email address", () => {
    const r = redactContactDetails(
      "Contact ForCalifornians@gmail.com for more.",
    );
    expectMatch(r.text, /\[REDACTED-EMAIL\]/);
    expectOk(!r.text.includes("@gmail.com"));
    expectEqual(r.hits[0].kind, "email");
  });

  test("removes phone numbers in the formats these filings use", () => {
    for (const p of ["628-243-1808", "916-446-6752", "(619) 806-0698"]) {
      const r = redactContactDetails(`Call ${p} today.`);
      expectMatch(r.text, /\[REDACTED-PHONE\]/, `failed on ${p}`);
    }
  });

  test("removes a street address with a suite", () => {
    const r = redactContactDetails(
      "3009 DOUGLAS BLVD. SUITE 300 ROSEVILLE, CA",
    );
    expectMatch(r.text, /\[REDACTED-ADDRESS\]/);
    expectOk(!r.text.includes("DOUGLAS"));
  });

  test("removes residential-looking street addresses", () => {
    // The two that prompted this module.
    for (const a of ["645 Taraval Street", "7031 Mission Street"]) {
      const r = redactContactDetails(`Proponent address: ${a}, San Francisco`);
      expectMatch(r.text, /\[REDACTED-ADDRESS\]/, `failed on ${a}`);
    }
  });

  test("leaves statutory references alone", () => {
    // If this ever starts matching, the fixture loses the text being scored.
    const legal =
      "Section 3 of Article XIII shall apply. See Elections Code § 9608. " +
      "Chapter 2 of Part 10.5 of Division 1 of Title 1.";
    expectEqual(redactContactDetails(legal).text, legal);
  });

  test("leaves measure content and dollar figures alone", () => {
    const body =
      "This measure appropriates $1,200,000 from the General Fund in 2026 " +
      "and caps annual growth at 5%.";
    expectEqual(redactContactDetails(body).text, body);
  });

  test("does not pad the placeholder to the original length", () => {
    // Preserving length would imply the original is recoverable from the
    // fixture. It should not be.
    const r = redactContactDetails("a-very-long-address@example-domain.org");
    expectEqual(r.text, "[REDACTED-EMAIL]");
  });

  test("reports every hit it made", () => {
    const r = redactContactDetails(
      "645 Taraval Street, call 628-243-1808 or ForCalifornians@gmail.com",
    );
    expectDeepEqual(r.hits.map((h) => h.kind).sort(), [
      "email",
      "phone",
      "street-address",
    ]);
  });
});

describe("findContactDetails", () => {
  test("is empty for already-redacted text", () => {
    const once = redactContactDetails("call 628-243-1808").text;
    // The post-condition used on fixture generation: redacting twice must
    // find nothing the second time.
    expectDeepEqual(findContactDetails(once), []);
  });

  test("finds what is still there", () => {
    expectEqual(findContactDetails("write to a@b.com").length, 1);
  });
});

describe("locateQuote — raw offsets (opuspopuli#1212)", () => {
  // The frontend renders fullText.slice(sourceStart, sourceEnd), so offsets
  // must index the ORIGINAL text. Matching still has to tolerate a model that
  // reflowed the passage, which is why the search runs on a normalised copy.
  const RAW =
    "SECTION 1.\n\n  Every public school   shall provide\n  instruction in earth sustainability.\n";

  it("returns offsets that slice the RAW text back to the quote", () => {
    const hit = locateQuote("Every public school shall provide", RAW);
    expect(hit).not.toBeNull();
    const sliced = RAW.slice(hit!.start, hit!.end).replace(/\s+/g, " ").trim();
    expect(sliced).toBe("Every public school shall provide");
  });

  it("does not return normalised positions when whitespace differs", () => {
    const hit = locateQuote("instruction in earth sustainability.", RAW);
    expect(hit).not.toBeNull();
    // The normalised index would land earlier than the raw one; slicing the
    // raw text at a normalised offset is exactly the silent mis-highlight.
    expect(RAW.slice(hit!.start, hit!.end)).toContain("instruction in earth");
  });

  it("returns null for a quote that is not present", () => {
    expect(locateQuote("all homework is hereby abolished", RAW)).toBeNull();
  });

  it("locates across an ellipsis and still maps to raw offsets", () => {
    const hit = locateQuote(
      "Every public school shall provide ... instruction in earth sustainability.",
      RAW,
    );
    expect(hit).not.toBeNull();
    expect(hit!.elided).toBe(true);
    expect(RAW.slice(hit!.start, hit!.end)).toContain("shall provide");
  });
});
