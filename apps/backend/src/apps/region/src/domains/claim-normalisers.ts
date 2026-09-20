import type { VerifiedState } from './evidence-verifier';
import type {
  BioClaim,
  MinutesSummaryClaim,
  PropositionAnalysisClaim,
} from '@opuspopuli/common';

/**
 * A citation reduced to what the verifier (#1292) can act on.
 *
 * Every field is nullable because the three generators cite in genuinely
 * different ways, and flattening that difference away is what makes an
 * unsourced assertion indistinguishable from a checked one.
 */
export interface NormalisedCitation {
  spanStart: number | null;
  spanEnd: number | null;
  quotedText: string | null;
  citationHint: string | null;
}

/** One claim, in the shape the relational model stores. */
export interface NormalisedClaim {
  /** The assertion being made. */
  text: string;
  /** Field of the subject this claim is about, where the source names one. */
  subjectField: string | null;
  /**
   * The generator's self-reported confidence, verbatim.
   *
   * Ordinal on purpose: all three generators report `high`/`medium`/`low`, and
   * mapping those onto a float would invent precision the model never
   * expressed — in a value that is recorded but deliberately never used as a
   * substitute for verification.
   */
  confidence: string | null;
  citation: NormalisedCitation;
}

const EMPTY_CITATION: NormalisedCitation = {
  spanStart: null,
  spanEnd: null,
  quotedText: null,
  citationHint: null,
};

/** Trim to a non-empty string, or null. Whitespace is not a citation. */
function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `propositions.analysis_claims` → claims.
 *
 * Carries offsets under the legacy contract and additionally a `sourceQuote`
 * under #1212's quote-then-locate. Both are passed through: the verifier
 * prefers the quote when present precisely because the offsets were measured
 * at ~2% accuracy when the model asserted them.
 */
export function normaliseAnalysisClaims(
  claims: PropositionAnalysisClaim[],
): NormalisedClaim[] {
  return claims.flatMap((c) => {
    const assertion = text(c.claim);
    if (!assertion) return [];

    return [
      {
        text: assertion,
        subjectField: text(c.field),
        confidence: text(c.confidence),
        citation: {
          spanStart: Number.isInteger(c.sourceStart) ? c.sourceStart : null,
          spanEnd: Number.isInteger(c.sourceEnd) ? c.sourceEnd : null,
          quotedText: text(c.sourceQuote),
          citationHint: null,
        },
      },
    ];
  });
}

/**
 * `minutes.summary_claims` → claims.
 *
 * The one family that quotes its source verbatim, and therefore the one the
 * gate can genuinely verify today. `title` is the assertion; `detail` is
 * context around it and is not something a citation can support, so it is not
 * folded into the claim text — doing so would dilute the vocabulary overlap
 * the gate scores with and make a good citation look unsupported.
 */
export function normaliseSummaryClaims(
  claims: MinutesSummaryClaim[],
): NormalisedClaim[] {
  return claims.flatMap((c) => {
    const assertion = text(c.title);
    if (!assertion) return [];

    return [
      {
        text: assertion,
        subjectField: text(c.kind),
        // Minutes claims carry `severity`, not a confidence.
        confidence: null,
        citation: {
          spanStart: null,
          spanEnd: null,
          quotedText: text(c.citation?.quote),
          citationHint: text(c.citation?.pageHint),
        },
      },
    ];
  });
}

/**
 * `representatives.bio_claims` → claims.
 *
 * Bio claims cite structured source *fields*, never text offsets, so nothing
 * here can ever be located in a document. That is why the two origins must
 * stay apart: `training` offered no citation at all and lands `unsourced`,
 * while `source` offered a dot-path that cannot be machine-checked and lands
 * `unverified`. Collapsing them would let a model's recollection read as
 * sourced.
 *
 * `sourceHint` is deliberately **not** carried into `citationHint`. On a
 * training-origin claim it is the model describing what kind of source it
 * believes it is recalling ("press coverage of the 2022 election") — a
 * self-report about recollection, not a citation that was offered. Storing it
 * in a citation column would flip the claim from `unsourced` to `unverified`
 * and make an uncited assertion read as a checked one that merely failed. It
 * stays in the JSONB blob, which remains authoritative.
 */
export function normaliseBioClaims(claims: BioClaim[]): NormalisedClaim[] {
  return claims.flatMap((c) => {
    const assertion = text(c.sentence);
    if (!assertion) return [];

    const field = c.origin === 'source' ? text(c.sourceField) : null;

    return [
      {
        text: assertion,
        subjectField: field,
        confidence: text(c.confidence),
        citation: { ...EMPTY_CITATION, citationHint: field },
      },
    ];
  });
}

/** The three families of subject that carry AI-generated claims. */
export type ClaimSubjectType = 'proposition' | 'minutes' | 'representative';

/**
 * What {@link recordClaims} needs to mirror one subject's claims (#1293).
 *
 * Lives here rather than beside the writer because it must stay free of any
 * Prisma type. `LlmGeneratorBase` names it in a method signature, and every
 * generator imports that base — so a Prisma type reachable from here would
 * pull the client's nested runtime into the declaration graph of half the
 * service, which TypeScript then cannot write out (TS2742/TS4053).
 */
export interface ClaimRecordInput {
  subjectType: ClaimSubjectType;
  /** Row id in the subject's own table. */
  subjectId: string;
  claims: NormalisedClaim[];
  /**
   * The derived text the citations point into, as it was when the claims were
   * generated. Null for subjects with no source text — representative bios
   * cite structured fields, so there is nothing to locate a quote in.
   */
  sourceText: string | null;
  /** SHA-256 of `sourceText` as it is **now**. */
  sourceTextHash: string | null;
  /**
   * SHA-256 of the text the claim was generated against, when that is not the
   * current text. Defaults to {@link sourceTextHash}.
   *
   * The two are identical at dual-write time — the claim was just produced
   * from the text being passed — so staleness cannot arise there. They come
   * apart in #1294's backfill, which reads claims written long ago against a
   * `fullText` that sync may have rewritten since. Keeping them as separate
   * inputs is what lets the gate return `stale-source` at all rather than
   * verifying a claim against text it never saw.
   */
  claimSourceTextHash?: string | null;
  /** Run that produced these claims (#1280), so a bad batch can be scoped. */
  pipelineExecutionId?: string | null;
}

export interface ClaimRecordOutcome {
  written: number;
  byState: Partial<Record<VerifiedState, number>>;
}
