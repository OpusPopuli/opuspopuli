import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { redactContactDetails, findContactDetails } from "./redaction.js";

describe("redactContactDetails", () => {
  test("removes an email address", () => {
    const r = redactContactDetails(
      "Contact ForCalifornians@gmail.com for more.",
    );
    assert.match(r.text, /\[REDACTED-EMAIL\]/);
    assert.ok(!r.text.includes("@gmail.com"));
    assert.equal(r.hits[0].kind, "email");
  });

  test("removes phone numbers in the formats these filings use", () => {
    for (const p of ["628-243-1808", "916-446-6752", "(619) 806-0698"]) {
      const r = redactContactDetails(`Call ${p} today.`);
      assert.match(r.text, /\[REDACTED-PHONE\]/, `failed on ${p}`);
    }
  });

  test("removes a street address with a suite", () => {
    const r = redactContactDetails(
      "3009 DOUGLAS BLVD. SUITE 300 ROSEVILLE, CA",
    );
    assert.match(r.text, /\[REDACTED-ADDRESS\]/);
    assert.ok(!r.text.includes("DOUGLAS"));
  });

  test("removes residential-looking street addresses", () => {
    // The two that prompted this module.
    for (const a of ["645 Taraval Street", "7031 Mission Street"]) {
      const r = redactContactDetails(`Proponent address: ${a}, San Francisco`);
      assert.match(r.text, /\[REDACTED-ADDRESS\]/, `failed on ${a}`);
    }
  });

  test("leaves statutory references alone", () => {
    // If this ever starts matching, the fixture loses the text being scored.
    const legal =
      "Section 3 of Article XIII shall apply. See Elections Code § 9608. " +
      "Chapter 2 of Part 10.5 of Division 1 of Title 1.";
    assert.equal(redactContactDetails(legal).text, legal);
  });

  test("leaves measure content and dollar figures alone", () => {
    const body =
      "This measure appropriates $1,200,000 from the General Fund in 2026 " +
      "and caps annual growth at 5%.";
    assert.equal(redactContactDetails(body).text, body);
  });

  test("does not pad the placeholder to the original length", () => {
    // Preserving length would imply the original is recoverable from the
    // fixture. It should not be.
    const r = redactContactDetails("a-very-long-address@example-domain.org");
    assert.equal(r.text, "[REDACTED-EMAIL]");
  });

  test("reports every hit it made", () => {
    const r = redactContactDetails(
      "645 Taraval Street, call 628-243-1808 or ForCalifornians@gmail.com",
    );
    assert.deepEqual(r.hits.map((h) => h.kind).sort(), [
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
    assert.deepEqual(findContactDetails(once), []);
  });

  test("finds what is still there", () => {
    assert.equal(findContactDetails("write to a@b.com").length, 1);
  });
});
