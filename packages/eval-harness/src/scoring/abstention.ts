/**
 * Abstention correctness — is an empty field the right answer?
 *
 * This scorer exists because the obvious alternative is actively harmful.
 *
 * In the first #1142 run a 3.4B granite build topped the scoreboard at 16/18
 * fields **because it fabricated the fiscal impact**, while qwen scored lower
 * for correctly returning an empty `fiscalImpact` — the honest answer, since
 * AG-filed initiative text carries no fiscal analysis. All six models returned
 * empty `fiscalImpact` on all five measures. That is a property of the source
 * data, not a model failure, and field completeness misread it as one.
 *
 * So completeness is never scored. What is scored is whether the model's
 * decision to speak or stay silent matches what the source can support:
 *
 *   source has the information + model filled it   -> correct
 *   source lacks the information + model left empty -> correct (ABSTAINED)
 *   source lacks the information + model filled it  -> FABRICATED
 *   source has the information + model left empty   -> missed
 *
 * The asymmetry is deliberate. Fabricating is much worse than missing, and the
 * two are reported separately rather than netted into one accuracy number.
 */

export type AbstentionVerdict =
  | "correct-filled"
  | "correct-abstained"
  | "fabricated"
  | "missed";

export interface FieldExpectation {
  field: string;
  /**
   * Can the source support this field at all? Authored per fixture, because
   * only a human reading the measure can say whether it contains a fiscal
   * analysis — that is precisely the judgement the model is being tested on.
   */
  supportable: boolean;
  /** Why, in the fixture author's words. Kept so a verdict can be argued with. */
  rationale?: string;
}

export interface AbstentionResult {
  field: string;
  verdict: AbstentionVerdict;
  correct: boolean;
  filled: boolean;
  supportable: boolean;
  rationale?: string;
}

export interface AbstentionScore {
  results: AbstentionResult[];
  correct: number;
  total: number;
  rate: number;
  /** Spoke where the source could not support it. The number that matters. */
  fabricated: number;
  /** Stayed silent where the source had the answer. */
  missed: number;
  /** Correctly stayed silent — invisible to a completeness metric. */
  abstained: number;
}

/**
 * Is this field populated?
 *
 * Whitespace, "N/A", "None", "Not specified" and "Unknown" all count as empty:
 * a model writing "Not specified" has abstained, and scoring that as filled
 * would hand credit for a non-answer. `existingVsProposed` is an object, so
 * emptiness is checked structurally rather than by string length.
 */
export function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "") return false;
    return !/^(n\/?a|none|not (specified|stated|applicable|available)|unknown|—|-)\.?$/i.test(
      v,
    );
  }
  if (Array.isArray(value)) return value.some((v) => isFilled(v));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      isFilled(v),
    );
  }
  return true;
}

export function scoreAbstention(
  payload: Record<string, unknown>,
  expectations: FieldExpectation[],
): AbstentionScore {
  const results: AbstentionResult[] = expectations.map((e) => {
    const filled = isFilled(payload[e.field]);
    let verdict: AbstentionVerdict;
    if (e.supportable) {
      verdict = filled ? "correct-filled" : "missed";
    } else {
      verdict = filled ? "fabricated" : "correct-abstained";
    }
    return {
      field: e.field,
      verdict,
      correct: verdict === "correct-filled" || verdict === "correct-abstained",
      filled,
      supportable: e.supportable,
      rationale: e.rationale,
    };
  });

  const count = (v: AbstentionVerdict): number =>
    results.filter((r) => r.verdict === v).length;

  return {
    results,
    correct: results.filter((r) => r.correct).length,
    total: results.length,
    rate:
      results.length === 0
        ? 0
        : results.filter((r) => r.correct).length / results.length,
    fabricated: count("fabricated"),
    missed: count("missed"),
    abstained: count("correct-abstained"),
  };
}
