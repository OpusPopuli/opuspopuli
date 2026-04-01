/**
 * Text Extractor Service
 *
 * Extracts structured data from plain text (PDF content, etc.)
 * using regex patterns and line-based rules.
 * Analogous to ManifestExtractorService for HTML, but operates
 * on plain text without DOM/CSS selectors.
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  TextExtractionRuleSet,
  TextFieldMapping,
  RawExtractionResult,
} from "@opuspopuli/common";
import { FieldTransformer } from "./field-transformer.js";

@Injectable()
export class TextExtractorService {
  private readonly logger = new Logger(TextExtractorService.name);

  /**
   * Extract data from plain text using text extraction rules.
   *
   * @param text - Plain text content (e.g., from PDF extraction)
   * @param rules - Text extraction rules from AI analysis
   * @param sourceUrl - Source URL for logging
   * @returns Raw extraction result with items and diagnostics
   */
  extract(
    text: string,
    rules: TextExtractionRuleSet,
    sourceUrl?: string,
  ): RawExtractionResult {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    // 1. Optionally narrow to data section
    let content = text;
    if (rules.dataSectionStart) {
      const startMatch = new RegExp(rules.dataSectionStart).exec(content);
      if (startMatch?.index !== undefined) {
        content = content.slice(startMatch.index);
      }
    }
    if (rules.dataSectionEnd) {
      const endMatch = new RegExp(rules.dataSectionEnd).exec(content);
      if (endMatch?.index !== undefined) {
        content = content.slice(0, endMatch.index);
      }
    }

    // 2. Skip header lines
    if (rules.skipLines && rules.skipLines > 0) {
      const lines = content.split("\n");
      content = lines.slice(rules.skipLines).join("\n");
    }

    // 3. Split into item blocks using delimiter
    const blocks = this.splitIntoBlocks(content, rules.itemDelimiter);

    this.logger.debug(
      `Split text into ${blocks.length} blocks using delimiter: ${rules.itemDelimiter}`,
    );

    // 4. Extract fields from each block
    const items: Record<string, unknown>[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;

      const item = this.extractItemFromBlock(block, rules.fieldMappings);
      if (item) {
        items.push(item);
      } else {
        warnings.push(`Block ${i}: no fields extracted`);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.debug(
      `Extracted ${items.length} items from ${sourceUrl ?? "text"} in ${duration}ms`,
    );

    return {
      items,
      success: items.length > 0,
      warnings,
      errors,
    };
  }

  /**
   * Split text into blocks using a delimiter pattern.
   */
  private splitIntoBlocks(text: string, delimiter: string): string[] {
    try {
      const regex = new RegExp(delimiter, "gm");
      return text.split(regex).filter((block) => block.trim().length > 0);
    } catch {
      // If delimiter isn't valid regex, use as literal string
      return text.split(delimiter).filter((block) => block.trim().length > 0);
    }
  }

  /**
   * Extract field values from a single text block using regex patterns.
   */
  private extractItemFromBlock(
    block: string,
    fieldMappings: TextFieldMapping[],
  ): Record<string, unknown> | null {
    const item: Record<string, unknown> = {};
    let hasRequiredFields = true;

    for (const mapping of fieldMappings) {
      const value = this.extractField(block, mapping);

      if (value !== undefined && value !== "") {
        item[mapping.fieldName] = value;
      } else if (mapping.defaultValue !== undefined) {
        item[mapping.fieldName] = mapping.defaultValue;
      } else if (mapping.required) {
        hasRequiredFields = false;
      }
    }

    // Only return items that have at least some extracted fields
    if (Object.keys(item).length === 0) return null;
    if (!hasRequiredFields) return null;

    return item;
  }

  /**
   * Extract a single field value from a text block using the mapping's regex pattern.
   */
  private extractField(
    block: string,
    mapping: TextFieldMapping,
  ): string | undefined {
    try {
      const match = new RegExp(mapping.pattern, "i").exec(block);

      if (!match) return undefined;

      const group = mapping.captureGroup ?? 1;
      let value = match[group] ?? match[0];
      value = value?.trim();

      // Apply transform if specified
      if (value && mapping.transform) {
        value = FieldTransformer.apply(value, mapping.transform);
      }

      return value || undefined;
    } catch {
      return undefined;
    }
  }
}
