/**
 * Shared utilities for scraping-pipeline handlers.
 *
 * Both ApiIngestHandler and BulkDownloadHandler contain identical
 * inferSourceSystem logic. Centralising it here eliminates the clone.
 */

import { createHash } from "node:crypto";
import type {
  DataSourceConfig,
  ExtractionResult,
  RawExtractionResult,
} from "@opuspopuli/common";
import type { DomainMapperService } from "../mapping/domain-mapper.service.js";

/** Characters of the digest kept when a readable discriminator isn't usable. */
const DIGEST_LEN = 8;

/**
 * Longest category inlined verbatim. `pipeline_executions.source_url` is
 * VarChar(1000); anything longer is digested instead of truncated, so the
 * identity stays bounded without two long categories sharing a prefix.
 */
const MAX_DISCRIMINATOR_LEN = 80;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, DIGEST_LEN);
}

/**
 * A token that differs between any two sources over the same file. Prefers the
 * category because it stays greppable in the database — that readability is
 * what lets an operator diagnose an empty source.
 */
function discriminatorFor(source: DataSourceConfig): string {
  const category = source.category?.trim();
  if (category && category.length <= MAX_DISCRIMINATOR_LEN) return category;
  // No category, or one too long to inline. `contentGoal` is required by
  // DataSourceConfig and necessarily differs between two sources over one
  // file, so it backstops a category-less config.
  return digest(category || source.contentGoal || "");
}

/**
 * Build the resume-session identity for a source.
 *
 * `pipeline_executions` is keyed on `(pipeline_job_id, source_url)`, so this
 * string must be unique per **source**, not per file. #950 appended the
 * extracted `filePattern` because several CAL-ACCESS tables come out of one
 * `dbwebexport.zip`. That is still not enough: two sources can read the *same
 * file* from the *same URL* for different purposes — `california.json` reads
 * `CVR_CAMPAIGN_DISCLOSURE_CD.TSV` twice, once for Form 496 IE cover pages
 * (#955) and once for the committee roster (#936). Those share one execution
 * row, so whichever runs second can inherit the first's applied-batch set and
 * skip its stream — silently, since `items_failed` stays 0. That makes
 * ingestion depend on source ordering (#984).
 *
 * See `discriminatorFor` for what separates two sources over one file.
 *
 * Changing this format is safe: sessions are scoped to `pipelineJobId`, which
 * is new on every run, so no cross-run resume state depends on it.
 */
export function sessionSourceKey(
  source: DataSourceConfig,
  filePattern?: string,
): string {
  const parts = [source.url];
  if (filePattern) parts.push(filePattern);
  parts.push(discriminatorFor(source));
  return parts.join("#");
}

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
