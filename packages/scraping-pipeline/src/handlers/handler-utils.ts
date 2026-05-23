/**
 * Shared utilities for scraping-pipeline handlers.
 *
 * Both ApiIngestHandler and BulkDownloadHandler contain identical
 * inferSourceSystem logic. Centralising it here eliminates the clone.
 */

import type {
  DataSourceConfig,
  ExtractionResult,
  RawExtractionResult,
} from "@opuspopuli/common";
import type { DomainMapperService } from "../mapping/domain-mapper.service.js";

/**
 * Build a RawExtractionResult, run it through the domain mapper, stamp
 * extractionTimeMs, and return. Shared by ApiIngestHandler and
 * BulkDownloadHandler to eliminate the identical map-and-return block.
 */
export function mapAndReturn<T>(
  items: Record<string, unknown>[],
  warnings: string[],
  errors: string[],
  source: DataSourceConfig,
  mapper: DomainMapperService,
  pipelineStart: number,
): ExtractionResult<T> {
  const rawResult: RawExtractionResult = {
    items,
    success: items.length > 0,
    warnings,
    errors,
  };
  const result = mapper.map<T>(rawResult, source);
  result.extractionTimeMs = Date.now() - pipelineStart;
  return result;
}

/**
 * Map one batch of raw items, accumulate warnings, and return the mapped
 * items. Shared by both streaming handlers — avoids re-building the
 * RawExtractionResult shell in each per-batch callback.
 */
export function mapBatchItems<T>(
  rawItems: Record<string, unknown>[],
  source: DataSourceConfig,
  mapper: DomainMapperService,
  warnings: string[],
): T[] {
  const rawResult: RawExtractionResult = {
    items: rawItems,
    success: rawItems.length > 0,
    warnings: [],
    errors: [],
  };
  const mapped = mapper.map<T>(rawResult, source);
  warnings.push(...mapped.warnings);
  return mapped.items;
}

/**
 * Build a failure ExtractionResult from a caught error.
 * Shared by ApiIngestHandler and BulkDownloadHandler to eliminate the
 * identical catch-block return value.
 */
export function buildFailureResult<T>(
  error: unknown,
  warnings: string[],
  errors: string[],
  pipelineStart: number,
): ExtractionResult<T> {
  errors.push((error as Error).message);
  return {
    items: [],
    manifestVersion: 0,
    success: false,
    warnings,
    errors,
    extractionTimeMs: Date.now() - pipelineStart,
  };
}

/**
 * Infer the sourceSystem value from the data source category.
 * Returns undefined when the category does not match a known system.
 */
export function inferSourceSystem(
  source: DataSourceConfig,
): string | undefined {
  const cat = (source.category ?? "").toLowerCase();
  if (cat.includes("cal-access") || cat.includes("cal_access")) {
    return "cal_access";
  }
  if (cat.includes("fec")) return "fec";
  return undefined;
}
