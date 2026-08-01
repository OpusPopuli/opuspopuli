/**
 * Self-Healing Service
 *
 * Determines when extraction failures should trigger re-analysis.
 * Bounded to prevent infinite LLM call loops.
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  ExtractionResult,
  RawExtractionResult,
  StructuralManifest,
} from "@opuspopuli/common";
import {
  ExtractionValidator,
  type ValidationResult,
} from "../extraction/extraction-validator.js";

export interface HealingDecision {
  /** Whether re-analysis should be triggered */
  shouldHeal: boolean;
  /** Reason for the decision */
  reason: string;
  /** Validation details */
  validation: ValidationResult;
}

@Injectable()
export class SelfHealingService {
  private readonly logger = new Logger(SelfHealingService.name);
  private readonly validator: ExtractionValidator;

  constructor() {
    this.validator = new ExtractionValidator();
  }

  /**
   * Determine if extraction results warrant re-analysis.
   *
   * @param result - The extraction result to evaluate
   * @param manifest - The manifest that produced the result
   * @param previousItemCount - Item count from last successful extraction
   * @param healAttempted - Whether healing has already been attempted this run
   * @returns Decision on whether to trigger re-analysis
   */
  evaluate(
    result: RawExtractionResult,
    manifest: StructuralManifest,
    previousItemCount?: number,
    healAttempted: boolean = false,
  ): HealingDecision {
    // Never attempt healing twice in one pipeline run
    if (healAttempted) {
      return {
        shouldHeal: false,
        reason: "Healing already attempted this run — avoiding infinite loop",
        validation: { valid: true, issues: [] },
      };
    }

    const validation = this.validator.validate(
      result,
      manifest,
      previousItemCount,
    );

    if (validation.valid) {
      return {
        shouldHeal: false,
        reason: "Extraction passed validation",
        validation,
      };
    }

    const errorMessages = validation.issues
      .filter((i) => i.severity === "error")
      .map((i) => i.message);

    this.logger.warn(
      `Self-healing triggered for ${manifest.sourceUrl}: ${errorMessages.join("; ")}`,
    );

    return {
      shouldHeal: true,
      reason: `Extraction validation failed: ${errorMessages.join("; ")}`,
      validation,
    };
  }

  /**
   * Post-mapping evaluation (#966 W1).
   *
   * The pre-mapping `evaluate()` can't see the failure mode where a drifted
   * selector matches the *wrong* elements: extraction "succeeds" with
   * plausible-looking items that the domain Zod schema then rejects. Those
   * rejections used to be swallowed as debug logs — a selector could drop
   * every item while the heal gate stayed green.
   *
   * Triggers healing when the schema rejected a majority of extracted items.
   * Intentional drops (identity-less meetings, non-ballot CVR2 rows) are not
   * counted as rejects by the mapper, so filtering-heavy sources don't loop.
   */
  evaluateMapping(
    raw: RawExtractionResult,
    mapped: ExtractionResult<unknown>,
    manifest: StructuralManifest,
    healAttempted: boolean = false,
  ): HealingDecision {
    if (healAttempted) {
      return {
        shouldHeal: false,
        reason: "Healing already attempted this run — avoiding infinite loop",
        validation: { valid: true, issues: [] },
      };
    }

    const reject = (mapped.selectorFailures ?? []).find(
      (f) => f.kind === "schema_reject",
    );
    if (!reject || raw.items.length === 0 || (reject.missRatio ?? 0) <= 0.5) {
      return {
        shouldHeal: false,
        reason: "Mapping losses within tolerance",
        validation: { valid: true, issues: [] },
      };
    }

    const detail = reject.schemaIssues?.[0]
      ? ` (${reject.schemaIssues[0]})`
      : "";
    const reason = `Domain mapping rejected ${Math.round((reject.missRatio ?? 0) * 100)}% of extracted items${detail}`;
    this.logger.warn(
      `Self-healing triggered for ${manifest.sourceUrl}: ${reason}`,
    );

    return {
      shouldHeal: true,
      reason,
      validation: {
        valid: false,
        issues: [{ severity: "error", message: reason }],
      },
    };
  }
}
