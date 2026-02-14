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
   *
   * @param result - The raw extraction result
   * @param manifest - The manifest used for extraction
   * @param previousItemCount - Item count from last successful extraction (for drift detection)
   * @returns Validation result with issues
   */
  validate(
    result: RawExtractionResult,
    manifest: StructuralManifest,
    previousItemCount?: number,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Check for complete failure
    if (!result.success) {
      issues.push({
        severity: "error",
        message: "Extraction failed — no items extracted",
      });
    }

    // Check for empty results
    if (result.items.length === 0) {
      issues.push({
        severity: "error",
        message: "Zero items extracted",
      });
    }

    // Check required field coverage
    const requiredFields = manifest.extractionRules.fieldMappings
      .filter((m) => m.required)
      .map((m) => m.fieldName);

    if (requiredFields.length > 0 && result.items.length > 0) {
      const missingFieldCounts = new Map<string, number>();

      for (const item of result.items) {
        for (const field of requiredFields) {
          if (
            item[field] === undefined ||
            item[field] === null ||
            item[field] === ""
          ) {
            missingFieldCounts.set(
              field,
              (missingFieldCounts.get(field) ?? 0) + 1,
            );
          }
        }
      }

      for (const [field, count] of missingFieldCounts) {
        const ratio = count / result.items.length;
        if (ratio > 0.5) {
          issues.push({
            severity: "error",
            message: `Required field "${field}" missing in ${Math.round(ratio * 100)}% of items (${count}/${result.items.length})`,
          });
        } else if (ratio > 0.1) {
          issues.push({
            severity: "warning",
            message: `Required field "${field}" missing in ${Math.round(ratio * 100)}% of items (${count}/${result.items.length})`,
          });
        }
      }
    }

    // Check for dramatic item count drift
    if (
      previousItemCount !== undefined &&
      previousItemCount > 0 &&
      result.items.length > 0
    ) {
      const ratio = result.items.length / previousItemCount;
      if (ratio < 0.5) {
        issues.push({
          severity: "error",
          message: `Item count dropped dramatically: ${result.items.length} vs previous ${previousItemCount} (${Math.round(ratio * 100)}%)`,
        });
      } else if (ratio < 0.8) {
        issues.push({
          severity: "warning",
          message: `Item count decreased: ${result.items.length} vs previous ${previousItemCount} (${Math.round(ratio * 100)}%)`,
        });
      }
    }

    // Check for excessive warnings
    if (result.warnings.length > result.items.length * 2) {
      issues.push({
        severity: "warning",
        message: `High warning count: ${result.warnings.length} warnings for ${result.items.length} items`,
      });
    }

    const hasErrors = issues.some((i) => i.severity === "error");
    if (hasErrors) {
      this.logger.warn(
        `Extraction validation failed for ${manifest.sourceUrl}: ${issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; ")}`,
      );
    }

    return {
      valid: !hasErrors,
      issues,
    };
  }
}
