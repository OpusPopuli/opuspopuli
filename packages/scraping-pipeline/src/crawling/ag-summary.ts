/**
 * Turn the Attorney General's title-and-summary PDF into embeddable text
 * (opuspopuli#1219).
 *
 * Every one of these PDFs opens with the same sentence:
 *
 *   "The Attorney General of California has prepared the following title and
 *    summary of the chief purpose and points of the proposed measure:"
 *
 * ── Why the preamble is stripped ─────────────────────────────────────────
 *
 * Because it is identical across every measure, and shared text is exactly
 * what broke retrieval before. #1156 measured nomic v1.5 at 0/14 top-1 on this
 * corpus with a pairwise cosine mean of 0.942 — every measure looked like every
 * other, because the distinguishing words were a small fraction of a field
 * dominated by boilerplate. Keeping this sentence would re-introduce a smaller
 * version of the same problem: a constant similarity floor that compresses the
 * range the encoder has left to discriminate in.
 *
 * The photographed sheet still carries the preamble, so the query side keeps
 * it. That asymmetry is deliberate and the right way round — boilerplate in a
 * query adds noise, boilerplate in every corpus row adds false agreement.
 *
 * ── What is deliberately NOT stripped ────────────────────────────────────
 *
 * The date line and initiative number at the top are left alone. They are
 * per-measure, they appear on the sheet, and 25-0006A1 differs from its
 * neighbours "only by a date" (#1219) — so the date is load-bearing signal for
 * exactly the rows most at risk of collapsing together.
 */

/** The invariant AG preamble, tolerant of the line breaks a PDF introduces. */
const PREAMBLE =
  /The\s+Attorney\s+General\s+of\s+California\s+has\s+prepared\s+the\s+following\s+(?:circulating\s+)?title\s+and\s+summary\s+of\s+the\s+chief\s+purpose\s+and\s+points\s+of\s+the\s+proposed\s+measure[:.]?/i;

/**
 * A page-footer artefact PDF extraction leaves behind. Safe to drop: it is
 * navigation, not content, and it repeats per page.
 */
const PAGE_FOOTER = /\bPage\s+\d+\s+of\s+\d+\b/gi;

export interface AgSummaryResult {
  /** Cleaned text, or null when the PDF did not look like a title-and-summary. */
  text: string | null;
  /** Why it was rejected, for the pipeline warning. */
  reason?: "too_short" | "no_preamble_or_title";
}

/**
 * Minimum length worth embedding.
 *
 * The real ones run ~1,000-1,600 characters (26-0004 measured at 1,090). A
 * couple of hundred characters means the fetch returned a cover page, an error
 * page, or a scanned image with no text layer — none of which should be
 * written into `summary`, because a short wrong answer there is worse than an
 * absent one: it looks like data and it silently degrades the embedding.
 */
const MIN_USEFUL_CHARS = 300;

export function extractAgSummary(pdfText: string): AgSummaryResult {
  const normalised = pdfText
    .replace(/\s+/g, " ")
    .replace(PAGE_FOOTER, " ")
    .trim();

  const match = PREAMBLE.exec(normalised);
  const body = match
    ? normalised.slice(match.index + match[0].length).trim()
    : normalised;

  if (!match && !looksLikeMeasureTitle(body)) {
    // Neither the preamble nor a measure-shaped title: this is not the
    // document we think it is. Refuse rather than guess.
    return { text: null, reason: "no_preamble_or_title" };
  }

  if (body.length < MIN_USEFUL_CHARS) {
    return { text: null, reason: "too_short" };
  }

  return { text: body };
}

/**
 * AG titles are set in capitals and end with the measure class, e.g.
 * "... INITIATIVE CONSTITUTIONAL AMENDMENT." Used only as a fallback when the
 * preamble is missing — some older PDFs word it differently, and rejecting
 * those outright would lose real summaries.
 */
function looksLikeMeasureTitle(text: string): boolean {
  return /\b(INITIATIVE|REFERENDUM)\s+(CONSTITUTIONAL\s+AMENDMENT|STATUTE)/i.test(
    text.slice(0, 600),
  );
}
