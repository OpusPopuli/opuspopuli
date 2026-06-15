import { Injectable, Logger } from '@nestjs/common';

/**
 * Outcome of running a candidate LLM-generated briefing summary
 * paragraph through the §10 commitment-4 guardrail pipeline.
 *
 * The shape mirrors `ExplanationValidatorService` so callers can
 * branch on `valid` and log `rejectionReason` uniformly. On rejection,
 * the caller MUST drop the LLM output silently — the frontend falls
 * back to the deterministic Phase 1 template, which means the briefing
 * never breaks even when the validator catches a regression.
 */
export interface BriefingSummaryValidationResult {
  readonly valid: boolean;
  readonly rejectionReason?:
    | 'empty'
    | 'word-count'
    | 'persuasion-language'
    | 'fabricated-claim';
}

export interface BriefingSummaryValidationContext {
  /** Output language the LLM was asked to produce. Drives bilingual regex selection. */
  readonly language: 'en' | 'es';
}

/**
 * Word-count window the prompt template asks for (30-60). Under the
 * floor it's too sparse to be a paragraph; over the ceiling and the
 * greeting card can't fit it. Mirrors the prompt's HARD CONSTRAINTS.
 */
const MIN_WORDS = 30;
const MAX_WORDS = 60;

/**
 * Persuasion / directive vocabulary banned by §10 commitment 4 ("we
 * will never use your information to target you politically"). The
 * prompt template instructs the LLM to never use these — this
 * validator is the independent backstop that silently drops outputs
 * that slip through.
 *
 * Bilingual: EN and ES patterns side by side. Both lists scan EVERY
 * output regardless of declared language so a mixed-language paragraph
 * gets caught either way. False positives just drop the LLM line and
 * surface the Phase 1 template — same fallback path as a cache miss.
 */
const PERSUASION_PHRASES_EN: RegExp[] = [
  /\byou should\b/i,
  /\byou must\b/i,
  /\byou need to\b/i,
  /\bmake sure to\b/i,
  /\bdon'?t miss\b/i,
  /\bdeserve to\b/i,
  /\bcritical for you\b/i,
  /\bimportant for you\b/i,
  /\b(we|i) (recommend|urge|encourage) (you|that)\b/i,
  /\bwe urge\b/i,
  /\bvote (for|against|yes|no)\b/i,
  /\bsupport (this|the) (bill|measure|proposition|legislation)\b/i,
  /\boppose (this|the) (bill|measure|proposition|legislation)\b/i,
  /\b(your|the) voice (matters|counts)\b/i,
];

const PERSUASION_PHRASES_ES: RegExp[] = [
  /\bdebes (leer|llamar|actuar|votar|apoyar|oponerte)\b/i,
  /\btienes que\b/i,
  /\bvota (a favor|en contra|sí|no)\b/i,
  /\bapoya (este|la|esta) (proyecto|medida|proposición|ley)\b/i,
  /\bopónete\b/i,
  /\bno te pierdas\b/i,
  /\bes (crucial|fundamental|esencial) para ti\b/i,
  /\bes importante para ti\b/i,
  /\bte (recomendamos|instamos|urgimos)\b/i,
  /\btu voz (importa|cuenta)\b/i,
];

/**
 * Surveillance language banned by §10 commitment 8 ("we will not
 * require you to be legible") — the LLM must never imply the platform
 * watches what the user does. Caught alongside the persuasion list;
 * same fallback consequence.
 */
const SURVEILLANCE_PHRASES: RegExp[] = [
  /\bwe (know|noticed|saw) you\b/i,
  /\bbased on (what|how) you\b/i,
  /\bsabemos que\b/i,
  /\bnotamos que\b/i,
];

/**
 * Detects the LLM inventing a specific named legislative artifact —
 * "AB 1234", "SB 50", "Proposition Z" — which the briefing-summary
 * prompt is NOT supposed to name (it only gets counts, not bill
 * identifiers). If the model fabricates a citation, drop it.
 */
const FABRICATED_BILL_CITATION =
  /\b(AB|SB|HR|HRES|S\.J\.\s*Res|Proposition|Prop\.?|Measure)\s*\d+\w*\b/i;

/**
 * Independent backstop on LLM-generated briefing summaries. Runs after
 * the prompt template has already instructed the model with HARD
 * CONSTRAINTS — this layer assumes the prompt is correctly authored and
 * catches drift / model hallucinations. The opuspopuli side OWNS this
 * validator (not the prompt-service) so an open-source contributor can
 * audit exactly what we're blocking without needing to read the
 * private prompt repo.
 */
@Injectable()
export class BriefingSummaryValidatorService {
  private readonly logger = new Logger(BriefingSummaryValidatorService.name);

  validate(
    paragraph: string,
    context: BriefingSummaryValidationContext,
  ): BriefingSummaryValidationResult {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) {
      return { valid: false, rejectionReason: 'empty' };
    }

    const words = trimmed.split(/\s+/u).filter((w) => w.length > 0);
    if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
      this.logger.debug(
        `Dropped briefing summary: word count ${words.length} outside [${MIN_WORDS},${MAX_WORDS}]`,
      );
      return { valid: false, rejectionReason: 'word-count' };
    }

    const persuasionEn = PERSUASION_PHRASES_EN.find((p) => p.test(trimmed));
    if (persuasionEn) {
      this.logger.debug(
        `Dropped briefing summary: EN persuasion match (${persuasionEn.source})`,
      );
      return { valid: false, rejectionReason: 'persuasion-language' };
    }
    const persuasionEs = PERSUASION_PHRASES_ES.find((p) => p.test(trimmed));
    if (persuasionEs) {
      this.logger.debug(
        `Dropped briefing summary: ES persuasion match (${persuasionEs.source})`,
      );
      return { valid: false, rejectionReason: 'persuasion-language' };
    }

    const surveillance = SURVEILLANCE_PHRASES.find((p) => p.test(trimmed));
    if (surveillance) {
      this.logger.debug(
        `Dropped briefing summary: surveillance language (${surveillance.source})`,
      );
      return { valid: false, rejectionReason: 'persuasion-language' };
    }

    if (FABRICATED_BILL_CITATION.test(trimmed)) {
      this.logger.debug(
        'Dropped briefing summary: fabricated bill citation (prompt does not provide bill numbers)',
      );
      return { valid: false, rejectionReason: 'fabricated-claim' };
    }

    // Context is currently unused — kept on the signature so future
    // bilingual rules can branch on declared language without a
    // contract change.
    void context;
    return { valid: true };
  }
}
