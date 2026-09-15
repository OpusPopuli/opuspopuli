import { extractLegislativeDigest } from "../src/crawling/legislative-digest";

/**
 * Verbatim head of the real ACA 7 enrolled-bill PDF text, as stored on
 * `propositions.fullText` in production, read 2026-09-14.
 */
const ACA7 =
  "Assembly Constitutional Amendment No. 7 ... relating to government " +
  "preferences. LEGISLATIVE COUNSEL'S DIGEST ACA 7, Jackson. Government " +
  "preferences. The California Constitution, pursuant to provisions enacted " +
  "by the Proposition 209, an initiative measure adopted by the voters at the " +
  "November 5, 1996, statewide general election, prohibits the state from " +
  "discriminating against, or granting preferential treatment to, any " +
  "individual or group on the basis of race, sex, color, ethnicity, or " +
  "national origin in the operation of public employment, public education, " +
  "or public contracting, as specified. This measure, the Closing the Student " +
  "Opportunity and Achievement Gap Act, would, instead, limit the above " +
  "prohibition to the operation of public employment, public higher education " +
  "admissions and enrollment, and public contracting. The measure would " +
  "require that it appear on the ballot at the November 7, 2028, statewide " +
  "general election. Resolved by the Assembly, the Senate concurring, that " +
  "the Legislature of the State of California at its 2025-26 Regular Session";

describe("extractLegislativeDigest (#1261)", () => {
  it("recovers the digest as the measure summary", () => {
    const { text } = extractLegislativeDigest(ACA7, "ACA 7");

    expect(text).toContain("The California Constitution");
    expect(text).toContain("Closing the Student Opportunity and Achievement");
    expect(text).toContain("November 7, 2028, statewide general election");
  });

  it("stops before the operative text", () => {
    const { text } = extractLegislativeDigest(ACA7, "ACA 7");

    expect(text).not.toContain("Resolved by the Assembly");
    expect(text).not.toContain("Senate concurring");
  });

  it("drops the citation header, which we already hold as columns", () => {
    const { text } = extractLegislativeDigest(ACA7, "ACA 7");

    expect(text).not.toContain("Jackson");
    expect(text!.startsWith("Government preferences.")).toBe(true);
  });

  /**
   * These PDFs are scanned and the OCR mangles the possessive differently
   * every time. All six spellings below were measured across the eight live
   * Secretary of State rows. Matching "LEGISLATIVE COUNSEL" exactly loses
   * SB 417 (COUNSEVS) and ACA 20 (COUNSECS) — a quarter of the corpus, with
   * nothing erroring.
   */
  it.each([
    ["COUNSEL'S", "apostrophe"],
    ["COUNSEL’S", "smart quote"],
    ["COUNSELis", "l-i-s"],
    ["COUNSEL>s", "angle bracket"],
    ["COUNSEVS", "V for L"],
    ["COUNSECS", "C for L"],
  ])("tolerates the OCR spelling %s (%s)", (spelling) => {
    const doc = ACA7.replace("COUNSEL'S", spelling);

    const { text } = extractLegislativeDigest(doc, "ACA 7");

    expect(text).toContain("Closing the Student Opportunity");
  });

  /**
   * ACA 13 is the only row WHEREAS terminates, and without it the digest runs
   * 1,553 characters into the resolution preamble — "now, therefore, be it
   * Resolved, That this measure shall be known as..." — which is not a
   * summary of anything.
   */
  it("stops at WHEREAS, not just at the enacting clause", () => {
    const doc =
      "LEGISLATIVE COUNSEL'S DIGEST ACA 13, Ward. Voting thresholds. This " +
      "measure would provide that an initiative measure takes effect only if " +
      "approved by the same proportion of votes it would impose on others, " +
      "and makes conforming changes to related provisions, as specified. " +
      "WHEREAS, The people of California have long held that the right to " +
      "vote is fundamental; now, therefore, be it Resolved, That this measure " +
      "shall be known as the Protect and Retain the Majority Vote Act";

    const { text } = extractLegislativeDigest(doc, "ACA 13");

    expect(text).toContain("initiative measure takes effect only if");
    expect(text).not.toContain("WHEREAS");
    expect(text).not.toContain("Protect and Retain the Majority Vote Act");
  });

  /**
   * The PDF reprints the bill identifier at every page break and the text
   * layer drops it mid-sentence. Measured live: "...other specified ACA20
   * purposes", "...the SB 417 CalHome Program", "...but not SB42 exceeding".
   */
  it("removes the running header the PDF injects mid-sentence", () => {
    const doc =
      "LEGISLATIVE COUNSEL'S DIGEST ACA 20, Gabriel. Save for California's " +
      "Future Act. The measure would require that money be appropriated for " +
      "unfunded liabilities and other specified ACA20 purposes, and would " +
      "revise the calculation in a manner that constitutes a change, as " +
      "specified by the Legislature in statute for that fiscal year.";

    const { text } = extractLegislativeDigest(doc, "ACA 20");

    expect(text).toContain("and other specified purposes");
    expect(text).not.toContain("ACA20");
  });

  /**
   * The inverse, and the more dangerous direction: ACA 21's entire substance
   * is a reference to a DIFFERENT measure. Stripping every bill-shaped token
   * would delete the only thing the summary says.
   */
  it("keeps a reference to a different measure", () => {
    const doc =
      "LEGISLATIVE COUNSEL>s DIGEST I·' ACA 21, as introduced, Rivas. " +
      "Withdrawal of Assembly Constitutional Amendment No. 13 of the 2023-24 " +
      "Regular Session. The Legislature adopted ACA 13 at the 2023-24 Regular " +
      "Session, relating to voting thresholds and local bond measures. This " +
      "measure instead would direct the Secretary of State to withdraw ACA 13 " +
      "from consideration by the voters.";

    const { text } = extractLegislativeDigest(doc, "ACA 21");

    expect(text).toContain("withdraw ACA 13 from consideration by the voters");
    expect(text!.startsWith("Withdrawal of Assembly")).toBe(true);
  });

  it("removes page furniture left by the PDF text layer", () => {
    const doc =
      "LEGISLATIVE COUNSEL'S DIGEST ACA 13, Ward. Voting thresholds. The " +
      "California Constitution provides that a proposed constitutional " +
      "amendment and a statewide initiative measure each take effect only if " +
      "approved by a majority of the votes cast on the amendment or measure. " +
      "This measure would further provide that an initiative measure imposing " +
      "a higher vote requirement on others takes effect only if approved by " +
      "that same proportion. The measure provides that if any provision is " +
      "held invalid, the other provisions of the act -- 2 of 6 -- -3- remain " +
      "valid, as specified. 95";

    const { text } = extractLegislativeDigest(doc, "ACA 13");

    expect(text).toContain("the other provisions of the act remain valid");
    expect(text).not.toMatch(/\d+ of \d+/);
    expect(text!.endsWith("as specified")).toBe(true);
  });

  /**
   * ACA 22 loses its vote threshold in three places, including the "Vote: %;"
   * line: the OCR dropped the fraction glyph, so "approval of two-thirds of
   * the voters" reads as "approval of % of the voters".
   *
   * It is reported, never repaired. The value is not recoverable from the
   * text, and a vote threshold is exactly the number that must not be guessed.
   */
  it("flags a percent sign the OCR left with no number", () => {
    const doc =
      "LEGISLATIVE COUNSEL’S DIGEST ACA 22, as introduced, Wicks. Local " +
      "taxes: limitation. The California Constitution conditions the " +
      "imposition of a special tax by a local government upon the approval of " +
      "% of the voters of the local government voting on that tax, and this " +
      "measure would revise that threshold as specified by the Legislature.";

    const { text, droppedFraction } = extractLegislativeDigest(doc, "ACA 22");

    expect(droppedFraction).toBe(true);
    // Reported, not rewritten: the text is still returned verbatim.
    expect(text).toContain("upon the approval of % of the voters");
  });

  it("does not flag a percentage that survived the OCR", () => {
    const doc =
      "LEGISLATIVE COUNSEL'S DIGEST SB 42, Umberg. Political Reform Act of " +
      "1974. The bill would require that a participating candidate receive " +
      "contributions equal to 50% of the applicable spending limit before " +
      "qualifying for public financing under the act, as specified.";

    const { droppedFraction } = extractLegislativeDigest(doc, "SB 42");

    expect(droppedFraction).toBe(false);
  });

  it("returns no text when the document carries no digest", () => {
    const result = extractLegislativeDigest(
      "COUNTY OF SONOMA REGISTRAR OF VOTERS OFFICE STATEMENT OF ACCURACY " +
        "The undersigned author(s) of the ARGUMENT IN FAVOR (300 WORDS)",
      "Measure E",
    );

    expect(result.text).toBeNull();
    expect(result.reason).toBe("no_digest_marker");
  });

  /**
   * A short wrong summary is worse than none: it looks like data, and it
   * silently degrades the embedding that a petition scan is matched against.
   */
  it("rejects a digest too short to be real", () => {
    const result = extractLegislativeDigest(
      "LEGISLATIVE COUNSEL'S DIGEST SB 1, Doe. A title. Vote: majority.",
      "SB 1",
    );

    expect(result.text).toBeNull();
    expect(result.reason).toBe("too_short");
  });

  it("returns no text for an empty document", () => {
    expect(extractLegislativeDigest("", "SB 1").text).toBeNull();
  });
});

/**
 * The embedding window (#1261).
 *
 * `summary` is embedded as `title + "\n\n" + summary` and the model discards
 * the overflow silently. Measured on the live nomic-embed-text-v2-moe: a
 * 2,300-character prefix of ACA 20's digest already embeds to a vector
 * byte-identical to the full 5,780 characters. The corpus has no row over the
 * window today (longest source 1,757 chars), so an uncapped digest would
 * INTRODUCE that defect rather than inherit it.
 */
describe("extractLegislativeDigest — embedding window", () => {
  const long = (chars: number) => {
    const sentence =
      "The measure would revise the allocation of funds to the account " +
      "and would make conforming changes to related provisions, as specified. ";
    let body = "";
    while (body.length < chars) body += sentence;
    return `LEGISLATIVE COUNSEL'S DIGEST ACA 20, Gabriel. Budget. ${body}`;
  };

  it("caps a digest that would overflow the embedding window", () => {
    const { text, truncated } = extractLegislativeDigest(long(5000), "ACA 20");

    expect(truncated).toBe(true);
    expect(text!.length).toBeLessThanOrEqual(1800);
  });

  it("cuts on a sentence boundary, not mid-word", () => {
    const { text } = extractLegislativeDigest(long(5000), "ACA 20");

    expect(text!.endsWith(".")).toBe(true);
  });

  it("leaves a digest that already fits untouched", () => {
    const { text, truncated } = extractLegislativeDigest(long(900), "ACA 20");

    expect(truncated).toBe(false);
    expect(text!.length).toBeGreaterThan(800);
  });
});

/**
 * A digest with no sentence end inside the budget. Rare, but an OCR pass that
 * loses full stops produces exactly this, and returning the whole paragraph
 * would put the row back over the embedding window.
 */
describe("extractLegislativeDigest — run-on text", () => {
  it("falls back to a hard cut when there is no sentence boundary", () => {
    const clause =
      "the measure would revise the allocation of funds and would make " +
      "conforming changes to related provisions and would further require " +
      "that the Controller transfer moneys as specified and would authorise " +
      "withdrawals ";
    const runOn =
      "LEGISLATIVE COUNSEL'S DIGEST ACA 20, Gabriel. Budget. " +
      clause.repeat(12);

    const { text, truncated } = extractLegislativeDigest(runOn, "ACA 20");

    expect(truncated).toBe(true);
    expect(text!.length).toBeLessThanOrEqual(1800);
  });
});
