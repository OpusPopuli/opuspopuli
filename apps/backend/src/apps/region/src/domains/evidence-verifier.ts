import { MIN_SUPPORT, locateQuote, supportRatio } from '@opuspopuli/common';
import { resolveEvidenceSpan } from './evidence-span';

/** The evidence states this verifier can assign. Mirrors the Prisma enum. */
export type VerifiedState = 'verified' | 'snapped' | 'unverified' | 'unsourced';

/** Why the verifier reached its conclusion. */
export type VerifyReason =
  | 'supported'
  | 'quote-relocated'
  | 'unsupported'
  | 'quote-not-found'
  | 'out-of-range'
  | 'stale-source'
  | 'no-citation';

/** What the verifier decides about one piece of evidence. */
export interface VerificationOutcome {
  state: VerifiedState;
  reason: VerifyReason;
  /** Vocabulary overlap between claim and cited text, 0-1. Always reported. */
  support: number;
  /**
   * Where the quote was actually found, set whenever that differs from what
   * was stored — including when nothing was stored. The state says which of
   * those it was: `snapped` corrects a span that pointed elsewhere, while a
   * `verified` claim carrying one had its offsets *derived* from the quote,
   * which is #1212's contract rather than a correction.
   */
  correctedSpan?: { start: number; end: number };
}

/** The stored citation, as the verifier needs to see it. */
export interface VerifiableEvidence {
  sourceTextHash: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  quotedText: string | null;
  citationHint: string | null;
}

/**
 * Decide whether a citation actually supports its claim (#1292).
 *
 * This is the only way evidence acquires a state — the schema has no default,
 * deliberately (#1291). Importing citations without passing them through here
 * would launder unverified assertions into a table called `evidence`, which is
 * the failure the evidence graph exists to prevent.
 *
 * Scoring is `supportRatio` from `@opuspopuli/common`, the same function the
 * eval harness reports with. That sharing is load-bearing: this issue's
 * acceptance criterion is that the harness's measured anchoring rate stays
 * reproducible as a query over stored evidence, which is only true if
 * measurement and enforcement are the same code.
 *
 * **Expect this to say `unverified` about most of the legacy corpus.** The
 * write path clamps offsets into range, so every stored span is "in range" by
 * construction, while #1212 measured roughly 2% genuinely anchored on this
 * contract. A gate reporting better numbers against that corpus would be
 * broken, not encouraging.
 *
 * @param claimText - The assertion being checked
 * @param evidence - The stored citation
 * @param sourceText - Current derived text the span indexes into
 * @param sourceHash - Hash of that text as it is now
 * @returns The state to store, with the reason and the support score
 */
export function verifyEvidence(
  claimText: string,
  evidence: VerifiableEvidence,
  sourceText: string | null,
  sourceHash: string | null,
): VerificationOutcome {
  const hasSpan = evidence.spanStart !== null && evidence.spanEnd !== null;
  const hasQuote = (evidence.quotedText ?? '').trim().length > 0;

  // A claim that never carried a citation is not a failed check. bio_claims'
  // `origin: 'training'` is this case, and #1208 is explicit that it must stay
  // distinguishable rather than being laundered into looking sourced.
  if (!hasSpan && !hasQuote && !evidence.citationHint) {
    return { state: 'unsourced', reason: 'no-citation', support: 0 };
  }

  // A quote can be relocated even when the stored span is unusable, so it is
  // tried before the span is judged — that is the whole point of
  // quote-then-locate (#1212).
  if (hasQuote && sourceText !== null) {
    return verifyQuoted(claimText, evidence, sourceText);
  }

  if (!hasSpan) {
    // A free-text citation hint (minutes.summary_claims) with nothing
    // machine-checkable behind it. Checked and not supported — not unsourced,
    // because a citation was offered.
    return { state: 'unverified', reason: 'no-citation', support: 0 };
  }

  const resolved = resolveEvidenceSpan(sourceText, sourceHash, evidence);

  if (resolved.status === 'stale') {
    // The text changed after the claim was made. Nothing can be verified
    // against text the claim never saw.
    return { state: 'unverified', reason: 'stale-source', support: 0 };
  }
  if (resolved.status !== 'resolved') {
    return { state: 'unverified', reason: 'out-of-range', support: 0 };
  }

  const support = supportRatio(claimText, resolved.text);
  return support >= MIN_SUPPORT
    ? { state: 'verified', reason: 'supported', support }
    : { state: 'unverified', reason: 'unsupported', support };
}

/**
 * Verify a claim that quoted its source rather than pointing at it.
 *
 * Support is scored on what was actually quoted, never on the span that
 * contains it: material the model elided is not evidence that it cited
 * anything, and bridging a wide gap must not be able to inflate the score.
 * Same rule the harness applies.
 */
function verifyQuoted(
  claimText: string,
  evidence: VerifiableEvidence,
  sourceText: string,
): VerificationOutcome {
  const quote = (evidence.quotedText ?? '').trim();
  const located = locateQuote(quote, sourceText);

  if (!located) {
    // The quote is not in the source. The model produced text that reads as a
    // citation and is not one.
    return { state: 'unverified', reason: 'quote-not-found', support: 0 };
  }

  const support = supportRatio(claimText, located.quoted);
  if (support < MIN_SUPPORT) {
    return { state: 'unverified', reason: 'unsupported', support };
  }

  const span = { start: located.start, end: located.end };
  const hadSpan = evidence.spanStart !== null && evidence.spanEnd !== null;

  // A citation that never carried a span did not point anywhere to be
  // corrected from, so locating its quote is derivation, not relocation
  // (#1293). Calling it `snapped` would understate verification for exactly
  // the family that cites best — `minutes.summary_claims` quotes verbatim and
  // stores no offsets, so every well-cited minutes claim would otherwise be
  // filed as a citation we had to move.
  if (!hadSpan) {
    return {
      state: 'verified',
      reason: 'supported',
      support,
      correctedSpan: span,
    };
  }

  // Found, but somewhere other than where the stored span said. Recorded as a
  // correction rather than merged into `verified`: a reader deserves to know
  // the citation was moved, and silently rewriting it would make the model
  // look more accurate than it was.
  const moved =
    evidence.spanStart !== located.start || evidence.spanEnd !== located.end;

  return moved
    ? {
        state: 'snapped',
        reason: 'quote-relocated',
        support,
        correctedSpan: span,
      }
    : { state: 'verified', reason: 'supported', support };
}
