/**
 * Extraction Validator
 *
 * Validates the quality of extraction results.
 * Used by the self-healing service to determine if
 * re-analysis should be triggered.
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  RawExtractionResult,
  StructuralManifest,
} from "@opuspopuli/common";

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  severity: "warning" | "error";
  message: string;
}

@Injectable()
export class ExtractionValidator {
  private readonly logger = new Logger(ExtractionValidator.name);

  /**
   * Validate extraction results against quality thresholds.
   */
  validate(
    result: RawExtractionResult,
    manifest: StructuralManifest,
    previousItemCount?: number,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    this.checkCompleteness(result, issues);
    this.checkRequiredFieldCoverage(result, manifest, issues);
    this.checkItemCountDrift(result, previousItemCount, issues);
    this.checkWarningCount(result, issues);

    const hasErrors = issues.some((i) => i.severity === "error");
    if (hasErrors) {
      const errorMessages = issues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("; ");
      this.logger.warn(
        "Extraction validation failed for " +
          manifest.sourceUrl +
          ": " +
          errorMessages,
      );
    }

    return { valid: !hasErrors, issues };
  }

  private checkCompleteness(
    result: RawExtractionResult,
    issues: ValidationIssue[],
  ): void {
    if (!result.success) {
      issues.push({
        severity: "error",
        message: "Extraction failed — no items extracted",
      });
    }
    if (result.items.length === 0) {
      issues.push({ severity: "error", message: "Zero items extracted" });
    }
  }

  private checkRequiredFieldCoverage(
    result: RawExtractionResult,
    manifest: StructuralManifest,
    issues: ValidationIssue[],
  ): void {
    const requiredFields = manifest.extractionRules.fieldMappings
      .filter((m) => m.required)
      .map((m) => m.fieldName);

    if (requiredFields.length === 0 || result.items.length === 0) {
      return;
    }

    const missingFieldCounts = this.countMissingFields(
      result.items,
      requiredFields,
    );

    for (const [field, count] of missingFieldCounts) {
      const ratio = count / result.items.length;
      const pct = Math.round(ratio * 100);
      const msg =
        'Required field "' +
        field +
        '" missing in ' +
        pct +
        "% of items (" +
        count +
        "/" +
        result.items.length +
        ")";

      if (ratio > 0.5) {
        issues.push({ severity: "error", message: msg });
      } else if (ratio > 0.1) {
        issues.push({ severity: "warning", message: msg });
      }
    }
  }

  private countMissingFields(
    items: Record<string, unknown>[],
    requiredFields: string[],
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const field of requiredFields) {
        const val = item[field];
        if (val === undefined || val === null || val === "") {
          counts.set(field, (counts.get(field) ?? 0) + 1);
        }
      }
    }
    return counts;
  }

  private checkItemCountDrift(
    result: RawExtractionResult,
    previousItemCount: number | undefined,
    issues: ValidationIssue[],
  ): void {
    if (
      previousItemCount === undefined ||
      previousItemCount === 0 ||
      result.items.length === 0
    ) {
      return;
    }

    const ratio = result.items.length / previousItemCount;
    const pct = Math.round(ratio * 100);

    if (ratio < 0.5) {
      issues.push({
        severity: "error",
        message:
          "Item count dropped dramatically: " +
          result.items.length +
          " vs previous " +
          previousItemCount +
          " (" +
          pct +
          "%)",
      });
    } else if (ratio < 0.8) {
      issues.push({
        severity: "warning",
        message:
          "Item count decreased: " +
          result.items.length +
          " vs previous " +
          previousItemCount +
          " (" +
          pct +
          "%)",
      });
    }
  }

  private checkWarningCount(
    result: RawExtractionResult,
    issues: ValidationIssue[],
  ): void {
    if (result.warnings.length > result.items.length * 2) {
      issues.push({
        severity: "warning",
        message:
          "High warning count: " +
          result.warnings.length +
          " warnings for " +
          result.items.length +
          " items",
      });
    }
  }
}
