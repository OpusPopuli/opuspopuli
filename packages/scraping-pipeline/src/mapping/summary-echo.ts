/**
 * Detect a `summary` that is really just the title repeated (opuspopuli#1219).
 *
 * ── The trap this has to avoid ───────────────────────────────────────────
 *
 * A real Attorney General summary DOES begin with the title. That is the
 * format — the title is the first sentence of the title-and-summary. So
 * "summary starts with title" flags every CORRECT row and is useless as a
 * test. Measured on the genuine 26-0004 document:
 *
 *   title    REPEALS "TOP TWO" OPEN PRIMARY ELECTION PROCESS. INITIATIVE ...
 *   summary  REPEALS "TOP TWO" OPEN PRIMARY ELECTION PROCESS. INITIATIVE ...
 *            Repeals law adopted by voters in 2010 that: (1) allows ...
 *
 * What separates good from bad is what is LEFT once the title is removed:
 *
 *   genuine (26-0004)     ~835 characters of substantive summary
 *   scraped echo (prod)   ~108 characters of "Title and Summary Issued on
 *                         July 16, 2025 Fiscal Impact Estimate Report"
 *
 * So the test is on the remainder, not the prefix.
 */

/** Scraper furniture seen in the 52 affected production rows. */
const FURNITURE =
  /(Title and Summary Issued on|Fiscal Impact Estimate Report|Submitted for Title and Summary|Comment period|Comments accepted through|Proponent\(s\)?:)/gi;

/**
 * Substance required after the title before a summary is believed.
 *
 * The genuine documents leave ~835 characters. The scraped echoes leave ~108,
 * and that is entirely furniture. 150 sits in the gap, close to the bad side:
 * the failure to avoid is flagging a real-but-terse summary, since that would
 * discard genuine text. A false negative here merely fails to warn.
 */
const MIN_SUBSTANCE_CHARS = 150;

export interface SummaryEchoVerdict {
  isEcho: boolean;
  /** Characters of non-furniture text left after removing the title. */
  substanceChars: number;
}

export function detectSummaryEcho(
  title: string | undefined,
  summary: string | undefined,
): SummaryEchoVerdict {
  if (!summary?.trim()) return { isEcho: false, substanceChars: 0 };

  const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
  const normSummary = normalise(summary);
  const normTitle = title ? normalise(title) : "";

  // An ECHO requires the title to actually be echoed. A summary that simply
  // does not begin with the title is not this defect, however terse it is —
  // judging on length alone would discard short but genuine summaries, which
  // is the opposite of the goal.
  const echoesTitle =
    normTitle.length > 0 &&
    normSummary.toLowerCase().startsWith(normTitle.toLowerCase());

  if (!echoesTitle) {
    return { isEcho: false, substanceChars: normSummary.length };
  }

  const remainder = normSummary.slice(normTitle.length).trim();

  const substance = remainder
    .replace(FURNITURE, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Dates and bare punctuation left behind by furniture removal are not
  // substance either.
  const meaningful = substance
    .replace(/\b\w+ \d{1,2}, \d{4}\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  return {
    isEcho: meaningful.length < MIN_SUBSTANCE_CHARS,
    substanceChars: meaningful.length,
  };
}
