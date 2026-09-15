/**
 * Recover the Legislative Counsel's Digest from an enrolled-bill PDF and use
 * it as the measure `summary` (opuspopuli#1261).
 *
 * ── The gap this fills ───────────────────────────────────────────────────
 *
 * The Secretary of State's qualified-ballot-measures page carries an
 * externalId, a title, a detailUrl and an election date — and no summary at
 * all. So every SOS-sourced measure reached the database with `summary` either
 * empty or holding the title echoed back (#1219). Measured on the eight live
 * rows: five were title echoes, three were empty.
 *
 * The detailUrl PDF, already fetched into `fullText`, opens with the
 * Legislative Counsel's Digest — a plain-language account of what the measure
 * changes, written by counsel for exactly this purpose. All eight rows carry
 * one. It is the best summary available for these measures and it is already
 * on disk.
 *
 * ── Why the start marker is loose ────────────────────────────────────────
 *
 * These PDFs are scanned, and the OCR mangles the possessive every time, in a
 * different way each time. Measured across the eight live rows, the token
 * following "LEGISLATIVE" was:
 *
 *   COUNSEL'S   COUNSEL’S   COUNSELis   COUNSEL>s   COUNSEVS   COUNSECS
 *
 * An exact match on "LEGISLATIVE COUNSEL" silently loses SB 417 (COUNSEVS) and
 * ACA 20 (COUNSECS) — two of eight, and neither errors. Matching `COUNSE\S*`
 * and anchoring on the word DIGEST catches all six spellings. DIGEST occurs
 * exactly once per document, so the anchor is unambiguous.
 */

/** Tolerant of every OCR spelling of "COUNSEL'S" measured on live rows. */
const DIGEST_START = /LEGISLATIVE\s+COUNSE\S*\s+DIGEST/i;

/**
 * Where the digest stops and the operative text begins.
 *
 * The earliest match wins. All five markers are needed: measured on the live
 * rows, `Vote:` terminates ACA 21 and ACA 22, `Resolved by the` terminates
 * ACA 7, ACA 20 and SCA 1, the enacting clause terminates SB 42 and SB 417,
 * and only `WHEREAS` terminates ACA 13 — without it ACA 13 runs 1,553 chars
 * past the digest into the resolution preamble ("now, therefore, be it
 * Resolved, That this measure shall be known as...").
 */
const DIGEST_END =
  /\bVote:\s*\S|\bResolved\s+by\s+the\b|\bThe\s+people\s+of\s+the\s+State\s+of\s+California\b|\bdo\s+enact\s+as\s+follows\b|\bWHEREAS\b/i;

/**
 * Page furniture the PDF text layer interleaves with the prose: "-- 2 of 6 --"
 * and the page number in dashes. Both land mid-sentence at every page break.
 */
const PAGE_FURNITURE = [
  /--\s*\d+\s*of\s*\d+\s*--/g,
  /[-—–]\s*\d{1,3}\s*[-—–]/g,
];

/**
 * A fraction glyph the OCR dropped, leaving a percent sign with no number:
 * "approval of % of the voters". ACA 22 loses its vote threshold in three
 * places this way — including the `Vote: %;` line.
 *
 * This is NOT repaired. The correct value is not recoverable from the text,
 * and a vote threshold is precisely the kind of number that must never be
 * guessed. It is reported so the caller can log it and a human can look.
 */
const DROPPED_FRACTION = /(?<![\d.])\s*%/;

/**
 * Minimum length worth writing into `summary`.
 *
 * The shortest real digest measured is ACA 21 at 441 characters — a one-line
 * withdrawal of a prior amendment. Anything much below that means the start
 * marker matched something that was not a digest, and a short wrong summary is
 * worse than none: it looks like data and it degrades the embedding.
 */
const MIN_USEFUL_CHARS = 200;

/**
 * Longest digest written into `summary`.
 *
 * `summary` is embedded as `title + "\n\n" + summary`, and the embedding
 * model silently discards whatever does not fit its window. Measured against
 * the live nomic-embed-text-v2-moe (context_length 512) by embedding
 * increasing prefixes of ACA 20's 5,780-character digest and comparing
 * vectors: at 2,300 characters the vector is already byte-identical to the
 * full text, so everything past ~2,300 was dropped with nothing reported.
 *
 * The existing corpus never hits this — its longest embedding source is 1,757
 * characters — so an uncapped digest would introduce silent truncation on
 * four rows (ACA 20, SB 42, SCA 1, SB 417) that the corpus does not have
 * today. 1,800 keeps the whole source inside the range the corpus already
 * demonstrates, with headroom for a longer title and for prose that tokenises
 * more densely than this sample.
 *
 * The cut is made at a sentence boundary and reported, so it is our decision
 * rather than the encoder quietly dropping the tail mid-word. The complete
 * digest is still on `fullText`; nothing is lost.
 */
const MAX_EMBEDDABLE_CHARS = 1800;

export interface LegislativeDigestResult {
  /** Cleaned digest text, or null when none could be recovered. */
  text: string | null;
  /** Why it was rejected, for the pipeline warning. */
  reason?: "no_digest_marker" | "too_short";
  /** The source OCR dropped a fraction glyph; the text understates a number. */
  droppedFraction?: boolean;
  /** The digest was longer than the embedding window and was cut short. */
  truncated?: boolean;
}

/**
 * @param fullText  the detailUrl PDF text, as stored on `fullText`
 * @param billId    the measure's own identifier, e.g. "ACA 20". Used to strip
 *                  the citation header and the running headers — see below.
 */
export function extractLegislativeDigest(
  fullText: string,
  billId?: string,
): LegislativeDigestResult {
  if (!fullText) return { text: null, reason: "no_digest_marker" };

  // Cheap reject before normalising. This runs over every proposition source,
  // including the Attorney General's — whose filings reach 115,077 characters
  // and never carry a digest. The marker's `\s+` spans the raw line breaks, so
  // testing here is equivalent to testing after normalisation.
  if (!DIGEST_START.test(fullText)) {
    return { text: null, reason: "no_digest_marker" };
  }

  const normalised = fullText.replace(/\s+/g, " ");
  const start = DIGEST_START.exec(normalised);
  if (!start) return { text: null, reason: "no_digest_marker" };

  const body = normalised.slice(start.index + start[0].length);
  const end = DIGEST_END.exec(body);
  let text = end ? body.slice(0, end.index) : body;

  const droppedFraction = DROPPED_FRACTION.test(text);

  for (const rx of PAGE_FURNITURE) text = text.replace(rx, " ");
  text = stripOwnBillId(text, billId);
  text = text
    .replace(/[|[\]]/g, " ")
    // OCR splits "immediately" as "immediate! y" on SB 417.
    .replace(/(?<=[a-z])!\s*y\b/g, "ly")
    // Punctuation debris left where a glyph failed to resolve: "-,," on ACA 21.
    .replace(/(?<![A-Za-z0-9])[-·,'"]{2,}(?![A-Za-z0-9])/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing bare number is the Legislative Counsel form number ("95")
    // printed at the foot of the page.
    .replace(/\s*\b\d{1,3}\s*$/, "")
    .replace(/^[\s.,\-—–·'"]+|[\s.,\-—–·'"]+$/g, "");

  if (text.length < MIN_USEFUL_CHARS) {
    return { text: null, reason: "too_short", droppedFraction };
  }

  const truncated = text.length > MAX_EMBEDDABLE_CHARS;
  if (truncated) text = cutAtSentence(text, MAX_EMBEDDABLE_CHARS);

  return { text, droppedFraction, truncated };
}

/**
 * Trim to at most `limit` characters, ending on a sentence boundary.
 *
 * Falls back to a hard cut only when the last 40% of the budget contains no
 * sentence end at all — better a clean character cut than returning a
 * paragraph that blows the embedding window.
 */
function cutAtSentence(text: string, limit: number): string {
  const head = text.slice(0, limit);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  if (lastStop > limit * 0.6) return head.slice(0, lastStop + 1).trim();
  return head.trim();
}

/**
 * Remove the measure's OWN identifier, in two places.
 *
 * 1. The citation header the digest opens with — "ACA 20, Gabriel." — which is
 *    metadata we already hold in structured columns, not summary prose.
 * 2. The running header the PDF repeats at every page break, which lands
 *    mid-sentence: "...appropriated for unfunded liabilities and other
 *    specified ACA20 purposes", "...the SB 417 CalHome Program", "...but not
 *    SB42 exceeding a maximum amount".
 *
 * Only the measure's own id is stripped. A digest that cites a DIFFERENT
 * measure is saying something load-bearing — ACA 21's entire substance is
 * "withdraw ACA 13 from consideration by the voters" — and removing that would
 * destroy the summary it is meant to produce.
 */
function stripOwnBillId(text: string, billId?: string): string {
  if (!billId) return text;
  const own = billId
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s*");
  return text
    .replace(new RegExp(`^.{0,24}?${own}\\s*,\\s*[^.]{1,80}\\.\\s*`, "i"), "")
    .replace(new RegExp(`\\s*\\b${own}\\b\\s*`, "gi"), " ");
}
