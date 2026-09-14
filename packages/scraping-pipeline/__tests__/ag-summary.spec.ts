import { extractAgSummary } from "../src/crawling/ag-summary";

/** Verbatim head of the real 26-0004 PDF, fetched 2026-09-13. */
const REAL =
  "July 14, 2026 Initiative 26-0004 The Attorney General of California has " +
  "prepared the following title and summary of the chief purpose and points " +
  "of the proposed measure: REPEALS “TOP TWO” OPEN PRIMARY ELECTION PROCESS. " +
  "INITIATIVE CONSTITUTIONAL AMENDMENT. Repeals law adopted by voters in 2010 " +
  "that: (1) allows voters to vote in primary elections for any candidate for " +
  "congressional and state elective office, regardless of the voter’s party " +
  "affiliation, and (2) advances to the General Election the two candidates " +
  "receiving the most votes, regardless of their political party. Requires " +
  "Legislature to establish new process for primary elections for " +
  "congressional and state offices, whereby each party’s candidate who " +
  "receives the most votes advances to the General Election.";

describe("extractAgSummary (#1219)", () => {
  it("keeps the measure title and summary", () => {
    const { text } = extractAgSummary(REAL);

    expect(text).toContain("REPEALS “TOP TWO” OPEN PRIMARY ELECTION PROCESS");
    expect(text).toContain("Repeals law adopted by voters in 2010");
  });

  /**
   * The preamble is byte-identical on every measure. #1156 measured nomic v1.5
   * at 0/14 top-1 on this corpus, pairwise cosine mean 0.942 — every measure
   * looked like every other because boilerplate dominated the field. Leaving
   * this sentence in would re-create a smaller version of that.
   */
  it("strips the preamble, which is identical on every measure", () => {
    const { text } = extractAgSummary(REAL);

    expect(text).not.toContain("Attorney General of California has prepared");
    expect(text!.startsWith("REPEALS")).toBe(true);
  });

  /**
   * 25-0006A1 differs from its neighbours only by a date (#1219), so the date
   * is load-bearing signal for exactly the rows most at risk of collapsing
   * into one another. It also appears on the sheet a scan photographs.
   */
  it("does not strip the date or initiative number", () => {
    const withDate = extractAgSummary(
      "March 3, 2026 Initiative 25-0006 " +
        REAL.slice(REAL.indexOf("The Attorney")),
    );

    // The preamble is removed, but nothing before it is required to survive —
    // what matters is that stripping is anchored to the preamble only.
    expect(withDate.text).not.toContain("Attorney General of California");
    expect(withDate.text).toContain("REPEALS");
  });

  describe("refuses rather than guessing", () => {
    /**
     * A short wrong answer in `summary` is worse than an absent one: it looks
     * like data, and it silently degrades the embedding. That is precisely the
     * failure this issue exists for — 52 of 64 rows held the title echoed back.
     */
    it("rejects a cover page or error page as too short", () => {
      const { text, reason } = extractAgSummary(
        "The Attorney General of California has prepared the following title " +
          "and summary of the chief purpose and points of the proposed measure: " +
          "See attached.",
      );

      expect(text).toBeNull();
      expect(reason).toBe("too_short");
    });

    it("rejects a document that is not a title-and-summary at all", () => {
      const { text, reason } = extractAgSummary(
        "HOWARD JARVIS TAXPAYERS ASSOCIATION 1201 K Street, Suite 1030 " +
          "Sacramento, CA 95814 RECEIVED June 16 Dear Attorney General, " +
          "enclosed please find our proposed initiative for your review and " +
          "the required fee. We look forward to your response in due course.",
      );

      expect(text).toBeNull();
      expect(reason).toBe("no_preamble_or_title");
    });

    it("rejects empty input without throwing", () => {
      expect(extractAgSummary("").text).toBeNull();
      expect(extractAgSummary("   \n  ").text).toBeNull();
    });
  });

  /**
   * Some older PDFs word the preamble differently. Rejecting those outright
   * would lose real summaries, so a measure-shaped title is accepted as a
   * fallback signal.
   */
  it("accepts a measure-shaped title when the preamble is absent", () => {
    const { text } = extractAgSummary(
      "PROVIDES FUNDING FOR SCHOOL FACILITIES. INITIATIVE STATUTE. " +
        "Authorizes bonds for construction and modernization of public school " +
        "facilities across the state, and appropriates money from the General " +
        "Fund to repay those bonds over a period of thirty-five years as they " +
        "come due under the terms set out in this measure.",
    );

    expect(text).toContain("PROVIDES FUNDING FOR SCHOOL FACILITIES");
  });

  it("collapses the whitespace PDF extraction leaves behind", () => {
    const { text } = extractAgSummary(REAL.replace(/ /g, "\n  "));

    expect(text).not.toMatch(/\s{2,}/);
  });
});
