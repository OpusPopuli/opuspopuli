/**
 * Shared claim-support scoring (#1292).
 *
 * Lifted out of `packages/eval-harness`, which is `private: true` and therefore
 * cannot be imported by the services. The harness now imports this module, so
 * the number the gate acts on and the number the harness reports are produced
 * by the same code.
 *
 * That sharing is the point, not a convenience. #1292's acceptance criterion is
 * that the harness's measured anchoring rate stays reproducible as a query over
 * stored evidence — which is only true if measurement and enforcement cannot
 * drift. The same reasoning moved `locateQuote` and `redactContactDetails` here
 * in #1212, after that drift had already happened once.
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "by",
  "with",
  "that",
  "this",
  "it",
  "is",
  "are",
  "be",
  "as",
  "at",
  "from",
  "would",
  "will",
  "shall",
  "may",
  "not",
  "which",
  "any",
  "all",
  "such",
]);

/**
 * Words worth matching on: lowercase, longer than two characters, not a
 * stopword.
 */
function contentWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      // `ñ` (U+00F1) already falls inside á-ú; `ü` (U+00FC) does not.
      .split(/[^a-z0-9á-úü]+/i)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/**
 * How much of the claim is actually present in the span it cites?
 *
 * A real citation shares vocabulary with the claim drawn from it. It is a weak
 * signal — it cannot tell "supports" from "mentions" — but it separates "cited
 * the right paragraph" from "cited 1,500 characters that happen to be in
 * range", which is the failure it was built for.
 *
 * **It is the pass/fail gate, not merely a reported number.** The harness's
 * original comment here claimed the opposite while the code already gated on
 * it; that was survivable in a dev harness and is not survivable now that the
 * same threshold decides whether a citation is labelled verified to a reader.
 *
 * @param claim - The assertion
 * @param span - The text offered in support of it
 * @returns Fraction of the claim's content words present in the span, 0-1
 */
export function supportRatio(claim: string, span: string): number {
  const words = contentWords(claim);
  if (words.length === 0) return 0;
  const spanWords = new Set(contentWords(span));
  return words.filter((w) => spanWords.has(w)).length / words.length;
}

/**
 * A span must share at least this much vocabulary with its claim to count as
 * supported.
 *
 * Set from the failure it must catch: granite's clamped half-measure spans
 * score low here precisely because they cite everything and support nothing in
 * particular. It is a deliberately low bar — it establishes that a citation is
 * about the right subject, not that it proves the claim.
 */
export const MIN_SUPPORT = 0.3;
