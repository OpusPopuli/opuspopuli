/**
 * Field Transformer
 *
 * Applies post-extraction transforms to field values.
 * Supports date parsing, name formatting, URL resolution,
 * regex replacement, and basic string transforms.
 */

import type { FieldTransform } from "@opuspopuli/common";

/**
 * Applies a FieldTransform to an extracted string value.
 */
export class FieldTransformer {
  /**
   * Apply a transform to a raw extracted value.
   *
   * @param value - The raw extracted string
   * @param transform - The transform to apply
   * @param baseUrl - Base URL for resolving relative URLs
   * @returns Transformed string value
   */
  static apply(
    value: string,
    transform: FieldTransform,
    baseUrl?: string,
  ): string {
    switch (transform.type) {
      case "trim":
        return value.trim();

      case "lowercase":
        return value.toLowerCase();

      case "uppercase":
        return value.toUpperCase();

      case "strip_html":
        return FieldTransformer.stripHtml(value);

      case "url_resolve":
        return FieldTransformer.resolveUrl(value, baseUrl);

      case "regex_replace":
        return FieldTransformer.regexReplace(value, transform.params);

      case "name_format":
        return FieldTransformer.formatName(value);

      case "date_parse":
        return FieldTransformer.parseDate(value, transform.params);

      default:
        return value;
    }
  }

  /**
   * Strip HTML tags from a string, returning only text content.
   */
  private static stripHtml(value: string): string {
    // Use iterative parsing instead of regex to avoid ReDoS concerns
    let result = "";
    let inTag = false;
    for (const ch of value) {
      if (ch === "<") {
        inTag = true;
      } else if (ch === ">") {
        inTag = false;
      } else if (!inTag) {
        result += ch;
      }
    }
    return result.trim();
  }

  /**
   * Resolve a relative URL against a base URL.
   */
  private static resolveUrl(value: string, baseUrl?: string): string {
    if (!baseUrl || !value) {
      return value;
    }

    // Already absolute
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }

    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  }

  /**
   * Apply a regex replacement.
   * Expects params.pattern and params.replacement.
   */
  private static regexReplace(
    value: string,
    params?: Record<string, string>,
  ): string {
    if (!params?.pattern) {
      return value;
    }

    try {
      const flags = params.flags ?? "g";
      const regex = new RegExp(params.pattern, flags);
      return value.replace(regex, params.replacement ?? "");
    } catch {
      return value;
    }
  }

  /**
   * Format a name from "Last, First" to "First Last".
   * If no comma found, returns the value as-is with normalized whitespace.
   */
  private static formatName(value: string): string {
    const trimmed = value.trim();

    if (trimmed.includes(",")) {
      const parts = trimmed.split(",").map((p) => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return `${parts[1]} ${parts[0]}`;
      }
    }

    // Normalize whitespace
    return trimmed.replaceAll(/\s+/g, " ");
  }

  /**
   * Parse a date string and return an ISO date string.
   * Supports common date formats found on government websites.
   *
   * Params:
   * - format: hint about expected format ("us", "iso", "long")
   */
  private static parseDate(
    value: string,
    params?: Record<string, string>,
  ): string {
    const trimmed = value.trim();

    // Try long format: "January 1, 2026" or "Feb 17, 2026"
    const longMatch = FieldTransformer.matchLongDate(trimmed);
    if (longMatch) {
      return longMatch;
    }

    // Try US format: MM/DD/YY or MM/DD/YYYY
    const usMatch = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (usMatch) {
      const month = Number(usMatch[1]) - 1;
      const day = Number(usMatch[2]);
      let year = Number(usMatch[3]);
      if (year < 100) {
        year += 2000;
      }
      return new Date(year, month, day).toISOString();
    }

    // Try ISO format: YYYY-MM-DD
    const isoMatch = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(trimmed).toISOString();
    }

    // Fallback: try native Date parsing
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    // Return as-is if unparseable
    return trimmed;
  }

  /**
   * Try to match a long-form date like "January 1, 2026" or "Feb 17, 2026".
   * Returns ISO string on success, undefined on failure.
   */
  private static matchLongDate(value: string): string | undefined {
    // Match: word followed by 1-2 digits, optional comma, then 4-digit year
    const match = /\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/.exec(value);
    if (!match) {
      return undefined;
    }
    const month = FieldTransformer.monthToNumber(match[1]);
    if (month < 0) {
      return undefined;
    }
    return new Date(Number(match[3]), month, Number(match[2])).toISOString();
  }

  /**
   * Convert month name or abbreviation to zero-based month number.
   */
  private static monthToNumber(month: string): number {
    const months: Record<string, number> = {
      january: 0,
      jan: 0,
      february: 1,
      feb: 1,
      march: 2,
      mar: 2,
      april: 3,
      apr: 3,
      may: 4,
      june: 5,
      jun: 5,
      july: 6,
      jul: 6,
      august: 7,
      aug: 7,
      september: 8,
      sep: 8,
      october: 9,
      oct: 9,
      november: 10,
      nov: 10,
      december: 11,
      dec: 11,
    };
    return months[month.toLowerCase()] ?? -1;
  }
}
