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
  SelectorFailure,
} from "@opuspopuli/common";
import { FieldTransformer } from "./field-transformer.js";
import { safeRegex } from "./safe-regex.js";
import { extractStructuredArray } from "./structured-extractor.js";

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
        selectorFailures: [
          {
            kind: "container_miss",
            selector: rules.containerSelector,
            message: "Container not found: " + rules.containerSelector,
          },
        ],
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
    const firstContainer = container.first() as Cheerio<Element>;
    let itemElements = firstContainer.find(rules.itemSelector);

    // Single-record fallback: when itemSelector === containerSelector the LLM
    // signaled that the container itself is the one item (detail page).
    if (
      itemElements.length === 0 &&
      rules.itemSelector === rules.containerSelector
    ) {
      itemElements = firstContainer;
    }

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
        selectorFailures: [
          {
            kind: "item_miss",
            selector: rules.itemSelector,
            containerSelector: rules.containerSelector,
            message:
              "No items found: " +
              rules.itemSelector +
              " within " +
              rules.containerSelector,
          },
        ],
      };
    }

    // Extract each item, counting per-field selector misses across all
    // attempted items (dropped items included — their misses are the signal).
    const items: Record<string, unknown>[] = [];
    const fieldMissCounts = new Map<string, number>();
    itemElements.each((_i, el) => {
      const result = this.extractItem(
        $,
        $(el as Element),
        firstContainer,
        rules.fieldMappings,
        fieldMissCounts,
        baseUrl,
      );

      if (result) {
        items.push(result.data);
        warnings.push(...result.warnings);
      }
    });

    const selectorFailures = this.collectFieldMissFailures(
      rules.fieldMappings,
      fieldMissCounts,
      itemElements.length,
      warnings,
    );

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
      ...(selectorFailures.length > 0 && { selectorFailures }),
    };
  }

  /**
   * Turn per-field selector-miss counts into structured failures.
   *
   * A field whose selector missed in ≥50% of attempted items has almost
   * certainly drifted — that includes non-required fields, which produced no
   * signal at all before #966 W1 (defaults and optionality masked them).
   */
  private collectFieldMissFailures(
    mappings: FieldMapping[],
    missCounts: Map<string, number>,
    attemptedItems: number,
    warnings: string[],
  ): SelectorFailure[] {
    const failures: SelectorFailure[] = [];
    if (attemptedItems === 0) {
      return failures;
    }

    for (const mapping of mappings) {
      const misses = missCounts.get(mapping.fieldName) ?? 0;
      const missRatio = misses / attemptedItems;
      if (missRatio < 0.5) {
        continue;
      }

      const pct = Math.round(missRatio * 100);
      const message =
        'Field "' +
        mapping.fieldName +
        '" selector matched nothing in ' +
        pct +
        "% of items (" +
        misses +
        "/" +
        attemptedItems +
        '): "' +
        (mapping.selector ?? "") +
        '"';
      failures.push({
        kind: "field_miss",
        field: mapping.fieldName,
        selector: mapping.selector,
        required: mapping.required === true,
        missRatio,
        message,
      });
      // Required-field misses already warn per item; surface the aggregate
      // for non-required fields, which were previously invisible.
      if (mapping.required !== true) {
        warnings.push(message);
      }
    }

    return failures;
  }

  /**
   * Extract a single item's fields using the field mappings.
   */
  private extractItem(
    $: CheerioAPI,
    element: Cheerio<Element>,
    container: Cheerio<Element>,
    mappings: FieldMapping[],
    fieldMissCounts: Map<string, number>,
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

      const scope = mapping.scope === "container" ? container : element;
      const { value, selectorMiss } = this.resolveFieldValue(
        $,
        scope,
        mapping,
        baseUrl,
      );

      // Selector-level miss, counted before defaults/transforms so a
      // defaultValue can't mask a drifted selector (#966 W1).
      if (selectorMiss) {
        fieldMissCounts.set(
          mapping.fieldName,
          (fieldMissCounts.get(mapping.fieldName) ?? 0) + 1,
        );
      }

      const isEmpty =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);

      if (isEmpty && mapping.required) {
        requiredMissing++;
        warnings.push('Required field "' + mapping.fieldName + '" missing');
      }

      if (!isEmpty) {
        this.setNestedValue(data, mapping.fieldName, value);
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
   * Returns a string for scalar methods, an array of objects for 'structured',
   * plus whether the field's selector matched nothing (measured before
   * transforms and defaults are applied, so they can't mask drift).
   */
  private resolveFieldValue(
    $: CheerioAPI,
    element: Cheerio<Element>,
    mapping: FieldMapping,
    baseUrl?: string,
  ): { value: unknown; selectorMiss: boolean } {
    // "constant" has no selector to break
    if (mapping.extractionMethod === "constant") {
      return {
        value: mapping.defaultValue || undefined,
        selectorMiss: false,
      };
    }

    // Structured extraction produces an array — transforms/defaults don't apply
    if (mapping.extractionMethod === "structured") {
      const value = this.extractStructuredArray($, element, mapping, baseUrl);
      return {
        value,
        selectorMiss: Boolean(mapping.selector) && value.length === 0,
      };
    }

    const raw = this.extractFieldValue($, element, mapping);
    const selectorMiss = Boolean(mapping.selector) && raw === undefined;

    let value: unknown = raw;
    if (value && mapping.transform) {
      value = FieldTransformer.apply(
        value as string,
        mapping.transform,
        baseUrl,
      );
    }

    if (!value && mapping.defaultValue !== undefined) {
      value = mapping.defaultValue;
    }

    return { value, selectorMiss };
  }

  /**
   * Extract an array of structured objects from repeating elements within the scope.
   * Delegates to the shared extractStructuredArray utility.
   */
  private extractStructuredArray(
    $: CheerioAPI,
    element: Cheerio<Element>,
    mapping: FieldMapping,
    baseUrl?: string,
  ): Record<string, string>[] {
    if (!mapping.selector || !mapping.children) return [];
    return extractStructuredArray(
      $,
      element,
      mapping.selector,
      mapping.children,
      baseUrl,
    );
  }

  /**
   * Set a value into data using dot-notation field name (e.g., "contactInfo.offices").
   * Creates intermediate objects as needed.
   */
  private setNestedValue(
    data: Record<string, unknown>,
    fieldName: string,
    value: unknown,
  ): void {
    if (!fieldName.includes(".")) {
      data[fieldName] = value;
      return;
    }

    const parts = fieldName.split(".");
    let current: Record<string, unknown> = data;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (
        typeof current[key] !== "object" ||
        current[key] === null ||
        Array.isArray(current[key])
      ) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    current[parts.at(-1)!] = value;
  }

  /**
   * Extract a single field value from an element using its mapping.
   */
  private extractFieldValue(
    $: CheerioAPI,
    element: Cheerio<Element>,
    mapping: FieldMapping,
  ): string | undefined {
    // "constant" is short-circuited in resolveFieldValue; skip if no selector
    if (!mapping.selector) {
      return undefined;
    }

    // LLM-generated manifests sometimes bake the "|attr:name" suffix
    // into the selector (a convention supported by detail-crawler and
    // structured-extractor). Cheerio parses that as a CSS selector and
    // chokes on ":name" as a pseudo-class. Strip the suffix here — the
    // attribute is carried separately on `mapping.attribute` when it
    // matters. See #594 / scrape regression.
    const rawSelector = mapping.selector;
    const pipeIdx = rawSelector.indexOf("|attr:");
    const cssSelector =
      pipeIdx >= 0 ? rawSelector.slice(0, pipeIdx) : rawSelector;

    // .find() only searches descendants — if nothing found, check if the
    // element itself matches the selector (e.g., itemSelector selects <a>
    // and field mapping also targets "a").
    let selected = element.find(cssSelector);
    if (selected.length === 0) {
      selected = element.filter(cssSelector);
    }

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
        const regex = safeRegex(mapping.regexPattern);
        if (!regex) {
          return undefined;
        }
        const rawText = first.text();
        return regex.exec(rawText)?.[mapping.regexGroup ?? 1] || undefined;
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
