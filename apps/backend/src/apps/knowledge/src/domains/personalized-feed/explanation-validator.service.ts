import { Injectable, Logger } from '@nestjs/common';

export interface ValidationContext {
  /**
   * Names of the 20 RankingFlags that are TRUE for this user. The
   * validator rejects explanations that name a protected-class status
   * derived from a flag the user did NOT declare (planning doc §5.3).
   */
  readonly userRankingFlags: string[];
}

export interface ValidationResult {
  readonly valid: boolean;
  /** Short machine-readable reason — surfaces in the dropped-explanation logs. */
  readonly rejectionReason?:
    | 'word-count'
    | 'opinion-language'
    | 'protected-class-leak'
    | 'empty';
}

/**
 * Lower bound from the prompt template. Anything below this is too
 * sparse to count as an explanation.
 */
const MIN_WORDS = 15;
/**
 * Upper bound. Above this the LLM has drifted into long-form prose;
 * the briefing card layout won't fit it.
 */
const MAX_WORDS = 30;

/**
 * Phrases that strongly signal vote-recommendation or opinion content
 * the prompt template explicitly bans (§5.3). Regex with `\b` word
 * boundaries so "vote for" doesn't match inside "the right to vote
 * for representatives." False positives just drop the explanation
 * (cache row still serves with embedding-only score), so the list is
 * still on the strict side.
 */
const OPINION_PHRASES: RegExp[] = [
  /\byou should\b/i,
  /\bwe recommend\b/i,
  /\bvote yes\b/i,
  /\bvote no\b/i,
  /\bvote for (this|the) (bill|measure|proposition)\b/i,
  /\bvote against (this|the) (bill|measure|proposition)\b/i,
  /\bsupport this (bill|measure|proposition)\b/i,
  /\boppose this (bill|measure|proposition)\b/i,
  /\bthis (bill|measure|proposition) is (good|bad|great|terrible)\b/i,
];

/**
 * Protected-class membership words the LLM may name only if the user
 * declared the corresponding flag. The mapping is to RankingFlag names
 * (the canonical declared-signal vocab in opuspopuli#742). If the user
 * did NOT declare the flag and the explanation references the word, the
 * LLM has likely inferred a protected status from indirect signals —
 * the planning-doc §5.3 prohibition.
 *
 * The list is conservative: words like "renter" / "parent" map to T2
 * flags that aren't protected-class, so they're not in the list.
 *
 * `label` is what we surface in the rejection log instead of the raw
 * RegExp source — debugging logs read better with "veteran" than with
 * "/\\bveteran(s)?\\b/i".
 */
const PROTECTED_CLASS_WORDS: {
  pattern: RegExp;
  label: string;
  flag: string;
}[] = [
  { pattern: /\bveteran(s)?\b/i, label: 'veteran', flag: 'isVeteran' },
  {
    pattern: /\bimmigrant(s)?\b/i,
    label: 'immigrant',
    flag: 'hasImmigrationConcern',
  },
  {
    pattern: /\bundocumented\b/i,
    label: 'undocumented',
    flag: 'hasImmigrationConcern',
  },
  {
    pattern: /\bdisab(led|ility)\b/i,
    label: 'disabled/disability',
    flag: 'hasHealthCondition',
  },
  {
    pattern: /\bchronic( |ally) ill\b/i,
    label: 'chronically ill',
    flag: 'hasHealthCondition',
  },
  { pattern: /\blow[- ]income\b/i, label: 'low-income', flag: 'isLowIncome' },
  { pattern: /\bpoverty\b/i, label: 'poverty', flag: 'isLowIncome' },
  {
    pattern: /\bformerly incarcerated\b/i,
    label: 'formerly incarcerated',
    flag: 'hasJusticeInvolvement',
  },
  // Public-benefits / safety-net language — protected-status-adjacent
  // (planning doc §5.3 treats receivesPublicBenefits + hasPublicHealthInsurance
  // as gated signals the LLM mustn't infer from non-declared users).
  {
    pattern: /\bmedicaid\b/i,
    label: 'Medicaid',
    flag: 'hasPublicHealthInsurance',
  },
  {
    pattern: /\bmedi[- ]?cal\b/i,
    label: 'Medi-Cal',
    flag: 'hasPublicHealthInsurance',
  },
  {
    pattern: /\bsnap (recipients?|beneficiaries|benefits?)\b/i,
    label: 'SNAP',
    flag: 'receivesPublicBenefits',
  },
  {
    pattern: /\bfood stamps?\b/i,
    label: 'food stamps',
    flag: 'receivesPublicBenefits',
  },
  {
    pattern: /\bpublic benefits?\b/i,
    label: 'public benefits',
    flag: 'receivesPublicBenefits',
  },
  {
    pattern: /\bwelfare recipients?\b/i,
    label: 'welfare',
    flag: 'receivesPublicBenefits',
  },
  {
    pattern: /\b(tanf|calworks)\b/i,
    label: 'TANF/CalWORKs',
    flag: 'receivesPublicBenefits',
  },
];

/**
 * Validates an LLM-generated relevance explanation against the planning
 * doc §5.3 constraints. Used by LlmRerankService — when validation
 * fails, the cache row still gets written with `relevanceExplanation:
 * null` so the feed serves with the embedding-only rank (the
 * no-explanation fallback). The frontend's WhyThisPanel falls back to
 * a heuristic axis explanation in that case (#744).
 */
@Injectable()
export class ExplanationValidatorService {
  private readonly logger = new Logger(ExplanationValidatorService.name);

  validate(explanation: string, context: ValidationContext): ValidationResult {
    const trimmed = explanation.trim();
    if (trimmed.length === 0) {
      return { valid: false, rejectionReason: 'empty' };
    }

    const words = trimmed.split(/\s+/u).filter((w) => w.length > 0);
    if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
      this.logger.debug(
        `Dropped explanation: word count ${words.length} outside [${MIN_WORDS},${MAX_WORDS}]`,
      );
      return { valid: false, rejectionReason: 'word-count' };
    }

    const opinionHit = OPINION_PHRASES.find((p) => p.test(trimmed));
    if (opinionHit) {
      this.logger.debug(
        `Dropped explanation: opinion / vote-recommendation language (${opinionHit.source})`,
      );
      return { valid: false, rejectionReason: 'opinion-language' };
    }

    const declaredFlags = new Set(context.userRankingFlags);
    for (const { pattern, label, flag } of PROTECTED_CLASS_WORDS) {
      if (pattern.test(trimmed) && !declaredFlags.has(flag)) {
        this.logger.debug(
          `Dropped explanation: references "${label}" but user did not declare "${flag}"`,
        );
        return { valid: false, rejectionReason: 'protected-class-leak' };
      }
    }

    return { valid: true };
  }
}
