/**
 * Claim-span anchoring — does `fullText[sourceStart:sourceEnd]` actually
 * support the claim it is attached to?
 *
 * This is the worst-performing measure in #1142: 8 of 121 claims anchored
 * correctly across six models, under 7%, with a best-anywhere score of 21%.
 * The failure mode is not near-misses. It is fabricated offsets:
 *
 *   - qwen emits neat sequential partitions — 260..580, 580..850, 850..1300 —
 *     i.e. it is PARTITIONING the document, not locating text in it.
 *   - granite cited 1240..5400 and 2700..3600 in a 2,799-character document.
 *     Those positions do not exist.
 *
 * Two things follow, and both are built in here.
 *
 * **Score raw offsets, never clamped ones.** `normalizePayload` in
 * proposition-analysis.service.ts clamps offsets into range, so granite's
 * 1240..5400 silently becomes 1240..2799 — a 1,559-character "citation"
 * spanning half the measure, rendered to citizens as precise attribution. A
 * scorer fed clamped offsets would see a plausible in-range span and miss the
 * defect entirely. `OFFSETS` therefore reports out-of-range explicitly.
 *
 * **Support both contracts.** #1212 replaces "ask the model for character
 * offsets" with "ask the model to quote, let code locate". That is a contract
 * change, not a model problem, and this scorer takes the contract as a
 * parameter so the same fixtures produce a before/after number instead of
 * being re-instrumented after the fact.
 */

export type AnchorContract = "offsets" | "quote-then-locate";

/** A claim as the model emitted it, under either contract. */
export interface EmittedClaim {
  claim: string;
  field: string;
  /** `offsets` contract: character positions into fullText, unclamped. */
  sourceStart?: number;
  sourceEnd?: number;
  /** `quote-then-locate` contract: the span the model says it is citing. */
  quote?: string;
  confidence?: number;
}

export type AnchorVerdict =
  | "anchored"
  | "out-of-range"
  | "quote-not-found"
  | "empty-span"
  | "unsupported"
  | "missing-anchor";

export interface AnchorResult {
  claim: string;
  field: string;
  verdict: AnchorVerdict;
  anchored: boolean;
  /** The span the citation actually resolves to, when it resolves at all. */
  resolved?: { start: number; end: number; text: string };
  /** Span length in characters — a 1,500-char "citation" is not a citation. */
  spanChars?: number;
  /** Fraction of the claim's content words present in the cited span. */
  support: number;
}

export interface AnchoringScore {
  contract: AnchorContract;
  results: AnchorResult[];
  anchored: number;
  total: number;
  rate: number;
  byVerdict: Record<string, number>;
  /** Evidence for "the model is partitioning, not locating" — see below. */
  looksPartitioned: boolean;
}

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

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9á-úñü]+/i)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * How much of the claim is actually present in the span it cites?
 *
 * A real citation shares vocabulary with the claim drawn from it. This is a
 * weak signal on its own — which is why it is reported as a number rather than
 * used as the pass/fail gate — but it separates "cited the right paragraph"
 * from "cited 1,500 characters that happen to be in range".
 */
export function supportRatio(claim: string, span: string): number {
  const words = contentWords(claim);
  if (words.length === 0) return 0;
  const spanWords = new Set(contentWords(span));
  return words.filter((w) => spanWords.has(w)).length / words.length;
}

/**
 * A span must share at least this much vocabulary with its claim to count as
 * anchored. Set from the failure it must catch: granite's clamped half-measure
 * spans score low here precisely because they cite everything and support
 * nothing in particular.
 */
export const MIN_SUPPORT = 0.3;

/**
 * Sequential partitioning detector.
 *
 * qwen's tell is that each claim's start equals the previous claim's end, over
 * and over — a document being cut into consecutive pieces rather than searched.
 * Three or more consecutive abutting spans is not a coincidence.
 */
export function detectPartitioning(claims: EmittedClaim[]): boolean {
  const spans = claims
    .filter(
      (c) =>
        typeof c.sourceStart === "number" && typeof c.sourceEnd === "number",
    )
    .map((c) => ({ start: c.sourceStart!, end: c.sourceEnd! }))
    .sort((a, b) => a.start - b.start);

  let run = 0;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start === spans[i - 1].end) {
      run++;
      if (run >= 2) return true; // 2 abutments == 3 consecutive spans
    } else {
      run = 0;
    }
  }
  return false;
}

function scoreOffsetClaim(claim: EmittedClaim, fullText: string): AnchorResult {
  const { sourceStart: start, sourceEnd: end } = claim;
  const base = { claim: claim.claim, field: claim.field, support: 0 };

  if (typeof start !== "number" || typeof end !== "number") {
    return { ...base, verdict: "missing-anchor", anchored: false };
  }
  // Deliberately checked BEFORE any clamping. This is the granite case, and
  // clamping is what hides it.
  if (start < 0 || end > fullText.length) {
    return { ...base, verdict: "out-of-range", anchored: false };
  }
  if (end <= start) {
    return { ...base, verdict: "empty-span", anchored: false };
  }

  const text = fullText.slice(start, end);
  const support = supportRatio(claim.claim, text);
  return {
    ...base,
    verdict: support >= MIN_SUPPORT ? "anchored" : "unsupported",
    anchored: support >= MIN_SUPPORT,
    resolved: { start, end, text },
    spanChars: end - start,
    support,
  };
}

function scoreQuoteClaim(claim: EmittedClaim, fullText: string): AnchorResult {
  const base = { claim: claim.claim, field: claim.field, support: 0 };
  const quote = claim.quote?.trim();

  if (!quote) {
    return { ...base, verdict: "missing-anchor", anchored: false };
  }

  // Code locates the quote — the whole point of #1212. Whitespace is
  // normalized because a model reflowing a line break is not a wrong citation.
  const needle = quote.replace(/\s+/g, " ");
  const haystack = fullText.replace(/\s+/g, " ");
  const at = haystack.indexOf(needle);

  if (at === -1) {
    return { ...base, verdict: "quote-not-found", anchored: false };
  }

  const support = supportRatio(claim.claim, needle);
  return {
    ...base,
    verdict: support >= MIN_SUPPORT ? "anchored" : "unsupported",
    anchored: support >= MIN_SUPPORT,
    resolved: { start: at, end: at + needle.length, text: needle },
    spanChars: needle.length,
    support,
  };
}

export function scoreAnchoring(
  claims: EmittedClaim[],
  fullText: string,
  contract: AnchorContract = "offsets",
): AnchoringScore {
  const results = claims.map((c) =>
    contract === "offsets"
      ? scoreOffsetClaim(c, fullText)
      : scoreQuoteClaim(c, fullText),
  );

  const byVerdict: Record<string, number> = {};
  for (const r of results) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  }

  const anchored = results.filter((r) => r.anchored).length;
  return {
    contract,
    results,
    anchored,
    total: results.length,
    // No claims is not a perfect score. A model that cites nothing has not
    // anchored anything, and reporting 1.0 would rank it above one that tried.
    rate: results.length === 0 ? 0 : anchored / results.length,
    byVerdict,
    looksPartitioned: contract === "offsets" && detectPartitioning(claims),
  };
}
