import { detectSummaryEcho } from "../src/mapping/summary-echo";

/** Verbatim from production, 2026-09-13 — one of the 52 affected rows. */
const ECHO_TITLE =
  "LIMITS ABILITY OF VOTERS TO RAISE REVENUES FOR LOCAL GOVERNMENT SERVICES. " +
  "INITIATIVE CONSTITUTIONAL AMENDMENT.";
const ECHO_SUMMARY =
  ECHO_TITLE +
  "\nTitle and Summary Issued on July 16, 2025\nFiscal Impact Estimate Report Proponent";

/** Verbatim from the genuine 26-0004 Attorney General PDF. */
const REAL_TITLE =
  "REPEALS “TOP TWO” OPEN PRIMARY ELECTION PROCESS. INITIATIVE CONSTITUTIONAL AMENDMENT.";
const REAL_SUMMARY =
  REAL_TITLE +
  " Repeals law adopted by voters in 2010 that: (1) allows voters to vote in " +
  "primary elections for any candidate for congressional and state elective " +
  "office, regardless of the voter’s party affiliation, and (2) advances to " +
  "the General Election the two candidates receiving the most votes, " +
  "regardless of their political party. Requires Legislature to establish a " +
  "new process for primary elections for congressional and state offices.";

describe("detectSummaryEcho (#1219)", () => {
  /**
   * THE test. A real AG summary begins with the title — that is the format,
   * the title is its first sentence. So "starts with the title" flags every
   * correct row and is useless. What separates good from bad is what is left
   * once the title is removed: ~835 characters of substance versus ~108 of
   * furniture.
   */
  it("does NOT flag a genuine summary, which also starts with the title", () => {
    const verdict = detectSummaryEcho(REAL_TITLE, REAL_SUMMARY);

    expect(verdict.isEcho).toBe(false);
    expect(verdict.substanceChars).toBeGreaterThan(300);
  });

  it("flags the production echo", () => {
    const verdict = detectSummaryEcho(ECHO_TITLE, ECHO_SUMMARY);

    expect(verdict.isEcho).toBe(true);
  });

  /**
   * The two rows that collapsed to embedding source hash 9f668ff8d88b. Both
   * must be caught, or the pair silently re-forms on the next sync.
   */
  it("flags both halves of the 25-0004A1 / 25-0005A1 pair", () => {
    for (const id of ["25-0004", "25-0005"]) {
      const verdict = detectSummaryEcho(
        ECHO_TITLE,
        `${ECHO_TITLE}\nTitle and Summary Issued on July 16, 2025 (${id})\nFiscal Impact Estimate Report`,
      );
      expect(verdict.isEcho).toBe(true);
    }
  });

  it("treats the title repeated with nothing after it as an echo", () => {
    expect(detectSummaryEcho(ECHO_TITLE, ECHO_TITLE).isEcho).toBe(true);
  });

  it("is not fooled by casing differences between the two fields", () => {
    const verdict = detectSummaryEcho(
      ECHO_TITLE,
      ECHO_TITLE.toLowerCase() + "\nTitle and Summary Issued on July 16, 2025",
    );

    expect(verdict.isEcho).toBe(true);
  });

  it("counts a date as furniture, not substance", () => {
    const verdict = detectSummaryEcho(
      ECHO_TITLE,
      `${ECHO_TITLE} September 19, 2025 July 16, 2025 March 3, 2026`,
    );

    expect(verdict.isEcho).toBe(true);
  });

  describe("does not flag absence", () => {
    // An absent summary is the honest state after #1219's other half; it is
    // not an echo and must not be reported as one, or every legitimately
    // unissued measure generates a warning.
    it("returns false for an empty or missing summary", () => {
      expect(detectSummaryEcho(ECHO_TITLE, undefined).isEcho).toBe(false);
      expect(detectSummaryEcho(ECHO_TITLE, "").isEcho).toBe(false);
      expect(detectSummaryEcho(ECHO_TITLE, "   ").isEcho).toBe(false);
    });
  });

  it("handles a missing title without throwing", () => {
    expect(detectSummaryEcho(undefined, REAL_SUMMARY).isEcho).toBe(false);
  });

  /**
   * A summary that does not begin with the title is judged on its own length.
   * Some sources word it differently, and there is no reason to demand the
   * prefix.
   */
  it("accepts a substantive summary that does not repeat the title", () => {
    const verdict = detectSummaryEcho(
      REAL_TITLE,
      "Repeals the law adopted by voters in 2010 governing primary elections " +
        "for congressional and state elective office, and requires the " +
        "Legislature to establish a replacement process for those contests.",
    );

    expect(verdict.isEcho).toBe(false);
  });
});
