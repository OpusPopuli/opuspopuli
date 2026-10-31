/**
 * Config Validator
 *
 * Validates DeclarativeRegionConfig using Zod schemas.
 * Ensures region configs are well-formed before pipeline execution.
 */

import { z } from "zod";
import { DataType, type DeclarativeRegionConfig } from "@opuspopuli/common";
import { parseDayOffset } from "../pipeline/fetch-url.js";

/**
 * A misspelt zone does not fail loudly downstream: `zonedWallClockToISO`
 * returns nothing, and a meeting's time is then rejected rather than placed.
 * Catch it when the config loads instead.
 */
const ianaZone = z
  .string()
  .min(1, "Timezone is required")
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Must be an IANA timezone such as America/Los_Angeles");

const DataSourceConfigSchema = z.object({
  url: z.string().url("Invalid URL format"),
  dataType: z.enum(DataType, {
    // zod 4 renamed `errorMap` to `error`.
    error: `Must be one of: ${Object.values(DataType).join(", ")}`,
  }),
  contentGoal: z
    .string()
    .min(10, "Content goal must be at least 10 characters"),
  category: z.string().optional(),
  hints: z.array(z.string()).optional(),
  rateLimitOverride: z.number().positive().optional(),
  timezone: ianaZone.optional(),
  dateQueryParams: z
    .record(
      z.string(),
      z
        .string()
        .refine(
          (offset) => parseDayOffset(offset) !== undefined,
          'Must be a day offset such as "+60d", "-30d" or "0d"',
        ),
    )
    .refine((params) => Object.keys(params).length > 0, "Must name a parameter")
    .optional(),
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
  timezone: ianaZone,
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
      const semanticErrors = [
        ...ConfigValidator.validateSemantics(
          result.data as DeclarativeRegionConfig,
        ),
        // Reads the input, not result.data: the schema strips sourceType and
        // linkDiscovery, which this check is about.
        ...ConfigValidator.validateDateWindows(
          config as DeclarativeRegionConfig,
        ),
      ];
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
   * `dateQueryParams` is applied only where a plain html_scrape source fetches
   * its own page. A link-discovery hub is fetched without it and its leaves
   * would inherit the window, and the pdf/api/bulk handlers never read it, so
   * anywhere else it would be a silent no-op or worse.
   */
  private static validateDateWindows(
    config: DeclarativeRegionConfig,
  ): ConfigValidationError[] {
    return config.dataSources.flatMap((source, i) => {
      const plainHtml =
        (source.sourceType ?? "html_scrape") === "html_scrape" &&
        !source.linkDiscovery;
      return source.dateQueryParams && !plainHtml
        ? [
            {
              path: "dataSources[" + i + "].dateQueryParams",
              message:
                "dateQueryParams applies only to an html_scrape source without linkDiscovery",
            },
          ]
        : [];
    });
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
      const key =
        source.url + "|" + source.dataType + "|" + (source.category ?? "");
      if (seen.has(key)) {
        const categorySuffix = source.category
          ? " (" + source.category + ")"
          : "";
        errors.push({
          path: "dataSources[" + i + "]",
          message:
            "Duplicate data source: " +
            source.url +
            " for " +
            source.dataType +
            categorySuffix,
        });
      }
      seen.add(key);
    }

    // Check that URLs use HTTPS
    for (let i = 0; i < config.dataSources.length; i++) {
      const source = config.dataSources[i];
      if (source.url.startsWith("http://")) {
        errors.push({
          path: "dataSources[" + i + "].url",
          message: "URL should use HTTPS for data source websites",
        });
      }
    }

    return errors;
  }
}
