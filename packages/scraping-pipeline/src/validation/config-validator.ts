/**
 * Config Validator
 *
 * Validates DeclarativeRegionConfig using Zod schemas.
 * Ensures region configs are well-formed before pipeline execution.
 */

import { z } from "zod";
import {
  CivicDataType,
  type DeclarativeRegionConfig,
} from "@opuspopuli/common";

const DataSourceConfigSchema = z.object({
  url: z.string().url("Invalid URL format"),
  dataType: z.nativeEnum(CivicDataType, {
    errorMap: () => ({
      message: `Must be one of: ${Object.values(CivicDataType).join(", ")}`,
    }),
  }),
  contentGoal: z
    .string()
    .min(10, "Content goal must be at least 10 characters"),
  category: z.string().optional(),
  hints: z.array(z.string()).optional(),
  rateLimitOverride: z.number().positive().optional(),
});

const DeclarativeRegionConfigSchema = z.object({
  regionId: z
    .string()
    .min(1, "Region ID is required")
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Region ID must be lowercase alphanumeric with hyphens, starting with a letter",
    ),
  regionName: z.string().min(1, "Region name is required"),
  description: z.string().min(1, "Description is required"),
  timezone: z.string().min(1, "Timezone is required"),
  dataSources: z
    .array(DataSourceConfigSchema)
    .min(1, "At least one data source is required"),
  rateLimit: z
    .object({
      requestsPerSecond: z.number().positive(),
      burstSize: z.number().positive().int(),
    })
    .optional(),
  cacheTtlMs: z.number().positive().int().optional(),
  requestTimeoutMs: z.number().positive().int().optional(),
});

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

export interface ConfigValidationError {
  path: string;
  message: string;
}

export class ConfigValidator {
  /**
   * Validate a DeclarativeRegionConfig.
   *
   * @param config - The config to validate
   * @returns Validation result with detailed error information
   */
  static validate(config: unknown): ConfigValidationResult {
    const result = DeclarativeRegionConfigSchema.safeParse(config);

    if (result.success) {
      // Additional semantic validations
      const semanticErrors = ConfigValidator.validateSemantics(
        result.data as DeclarativeRegionConfig,
      );
      return {
        valid: semanticErrors.length === 0,
        errors: semanticErrors,
      };
    }

    return {
      valid: false,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  /**
   * Additional semantic validations beyond schema.
   */
  private static validateSemantics(
    config: DeclarativeRegionConfig,
  ): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Check for duplicate URLs + dataType combinations
    const seen = new Set<string>();
    for (let i = 0; i < config.dataSources.length; i++) {
      const source = config.dataSources[i];
      const key = `${source.url}|${source.dataType}|${source.category ?? ""}`;
      if (seen.has(key)) {
        errors.push({
          path: `dataSources[${i}]`,
          message: `Duplicate data source: ${source.url} for ${source.dataType}${source.category ? ` (${source.category})` : ""}`,
        });
      }
      seen.add(key);
    }

    // Check that URLs use HTTPS
    for (let i = 0; i < config.dataSources.length; i++) {
      const source = config.dataSources[i];
      if (source.url.startsWith("http://")) {
        errors.push({
          path: `dataSources[${i}].url`,
          message: "URL should use HTTPS for government websites",
        });
      }
    }

    return errors;
  }
}
