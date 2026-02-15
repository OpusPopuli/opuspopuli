/**
 * Manifest Extractor Service
 *
 * Extracts data from HTML using a structural manifest's CSS selectors.
 * This is the deterministic, cheap step — no LLM calls needed.
 * Uses Cheerio for DOM querying.
 */

import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type {
  StructuralManifest,
  FieldMapping,
  PreprocessingStep,
  RawExtractionResult,
} from "@opuspopuli/common";
import { FieldTransformer } from "./field-transformer.js";

@Injectable()
export class ManifestExtractorService {
  private readonly logger = new Logger(ManifestExtractorService.name);

  /**
   * Extract data from HTML using a structural manifest.
   *
   * @param html - Raw HTML content
   * @param manifest - The structural manifest with extraction rules
   * @param baseUrl - Base URL for resolving relative URLs
   * @returns Raw extraction result with items and diagnostics
   */
  extract(
    html: string,
    manifest: StructuralManifest,
    baseUrl?: string,
  ): RawExtractionResult {
    const startTime = Date.now();
    const rules = manifest.extractionRules;
    const warnings: string[] = [];
    const errors: string[] = [];

    const $ = cheerio.load(html);

    // Apply preprocessing steps
    if (rules.preprocessing) {
      for (const step of rules.preprocessing) {
        this.applyPreprocessing($, step);
      }
    }

    // Find the container element
    const container = $(rules.containerSelector);
    if (container.length === 0) {
      const msg = 'Container not found: "' + rules.containerSelector + '"';
      this.logger.warn(msg + " for " + manifest.sourceUrl);
      return {
        items: [],
        success: false,
        warnings: [],
        errors: ["Container not found: " + rules.containerSelector],
      };
    }

    if (container.length > 1) {
      warnings.push(
        "Multiple containers found (" +
          container.length +
          ') for "' +
          rules.containerSelector +
          '", using first',
      );
    }

    // Find items within the container
    const itemElements = container.first().find(rules.itemSelector);

    if (itemElements.length === 0) {
      this.logger.warn(
        'No items found: "' +
          rules.itemSelector +
          '" within "' +
          rules.containerSelector +
          '" for ' +
          manifest.sourceUrl,
      );
      return {
        items: [],
        success: false,
        warnings,
        errors: [
          "No items found: " +
            rules.itemSelector +
            " within " +
            rules.containerSelector,
        ],
      };
    }

    // Extract each item
    const items: Record<string, unknown>[] = [];
    itemElements.each((_i, el) => {
      const result = this.extractItem(
        $,
        $(el as Element),
        rules.fieldMappings,
        baseUrl,
      );

      if (result) {
        items.push(result.data);
        warnings.push(...result.warnings);
      }
    });

    const duration = Date.now() - startTime;
    this.logger.debug(
      "Extracted " +
        items.length +
        " items from " +
        manifest.sourceUrl +
        " in " +
        duration +
        "ms",
    );

    return {
      items,
      success: items.length > 0,
      warnings,
      errors,
    };
  }

  /**
   * Extract a single item's fields using the field mappings.
   */
  private extractItem(
    $: CheerioAPI,
    element: Cheerio<Element>,
    mappings: FieldMapping[],
    baseUrl?: string,
  ): { data: Record<string, unknown>; warnings: string[] } | null {
    const data: Record<string, unknown> = {};
    const warnings: string[] = [];
    let requiredMissing = 0;
    let requiredTotal = 0;

    for (const mapping of mappings) {
      if (mapping.required) {
        requiredTotal++;
      }

      const value = this.resolveFieldValue($, element, mapping, baseUrl);

      if (!value && mapping.required) {
        requiredMissing++;
        warnings.push('Required field "' + mapping.fieldName + '" missing');
      }

      if (value !== undefined && value !== null) {
        data[mapping.fieldName] = value;
      }
    }

    // Skip items where ALL required fields are missing
    if (requiredTotal > 0 && requiredMissing === requiredTotal) {
      return null;
    }

    return { data, warnings };
  }

  /**
   * Extract, transform, and apply defaults for a single field.
   */
  private resolveFieldValue(
    $: CheerioAPI,
    element: Cheerio<Element>,
    mapping: FieldMapping,
    baseUrl?: string,
  ): string | undefined {
    let value = this.extractFieldValue($, element, mapping);

    if (value && mapping.transform) {
      value = FieldTransformer.apply(value, mapping.transform, baseUrl);
    }

    if (!value && mapping.defaultValue !== undefined) {
      value = mapping.defaultValue;
    }

    return value;
  }

  /**
   * Extract a single field value from an element using its mapping.
   */
  private extractFieldValue(
    $: CheerioAPI,
    element: Cheerio<Element>,
    mapping: FieldMapping,
  ): string | undefined {
    const selected = element.find(mapping.selector);

    if (selected.length === 0) {
      return undefined;
    }

    const first = selected.first();

    switch (mapping.extractionMethod) {
      case "text":
        return first.text().trim() || undefined;

      case "attribute":
        if (!mapping.attribute) {
          return undefined;
        }
        return first.attr(mapping.attribute) || undefined;

      case "html":
        return first.html() || undefined;

      case "regex": {
        if (!mapping.regexPattern) {
          return undefined;
        }
        const rawText = first.text();
        try {
          const match = rawText.match(new RegExp(mapping.regexPattern));
          return match?.[mapping.regexGroup ?? 1] || undefined;
        } catch {
          return undefined;
        }
      }

      default:
        return undefined;
    }
  }

  /**
   * Apply a preprocessing step to the DOM.
   */
  private applyPreprocessing($: CheerioAPI, step: PreprocessingStep): void {
    switch (step.type) {
      case "remove_elements":
        $(step.selector).remove();
        break;

      case "unwrap_elements":
        $(step.selector).each(function () {
          $(this).replaceWith($(this).contents());
        });
        break;

      case "merge_tables": {
        // Merge multiple tables matching the selector into one
        const tables = $(step.selector);
        if (tables.length > 1) {
          const firstTable = tables.first();
          tables.slice(1).each(function () {
            const rows = $(this).find("tbody tr, tr");
            const tbody = firstTable.find("tbody");
            if (tbody.length > 0) {
              tbody.append(rows);
            } else {
              firstTable.append(rows);
            }
            $(this).remove();
          });
        }
        break;
      }
    }
  }
}
