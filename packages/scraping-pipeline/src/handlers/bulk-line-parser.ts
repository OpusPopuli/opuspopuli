/**
 * The line parser for bulk exports: what one export line becomes before the
 * domain mapper sees it. Split out of `bulk-download.handler.ts` so the
 * mapping-version pin (`__tests__/bulk-import-key.spec.ts`) covers the code
 * that shapes a row and nothing else: an edit to the download, ledger or
 * scope code must not cost a full rewrite (`campaign-finance-phase-b.md`, D2).
 */

import { Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { BulkDownloadConfig, DataSourceConfig } from "@opuspopuli/common";
import { inferSourceSystem } from "./handler-utils.js";

// Logged under the handler's name, as before the split.
const logger = new Logger("BulkDownloadHandler");

/**
 * Joins `compositeKey` column values into an `externalId`. Matches the shape
 * single-column ids already have in this codebase (`<FILING_ID>:<LINE_ITEM>`).
 *
 * Note this is a display/identity convention only — nothing parses an id back
 * apart. The one consumer that did (`extractFilingId`) was replaced by a real
 * `filing_id` column in #980, precisely so that changing a key's layout can
 * never silently break a downstream reader again.
 */
const COMPOSITE_KEY_SEPARATOR = ":";

/**
 * Everything a single data line needs to become a record. Bundled rather than
 * passed positionally — the parameter list had reached the point where adding
 * one more (SonarCloud S107 caps it at 7) traded a readable signature for a
 * lint waiver.
 */
interface ParseContext {
  delimiter: string;
  mappings: Record<string, string>;
  filters: Record<string, string>;
  colIndices: Record<string, number>;
  filterIndices: Record<string, number>;
  compositeIndices: number[];
  sourceSystem: string | undefined;
}

/**
 * SHA-256 of one raw export line, hex-encoded (#1277).
 *
 * The line as read from the decoded stream — bulk exports are read through a
 * text decode, so per-record *bytes* are not separably addressable without
 * re-reading the archive. This is the finest-grained honest witness available
 * at ingest, and it is enough to locate the record in a retained snapshot.
 */
function hashSourceRecord(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * Create a stateful line parser that handles headers, skipping, and mapping.
 */
export function createLineParser(
  bulk: BulkDownloadConfig,
  source: DataSourceConfig,
) {
  const delimiter = getDelimiter(bulk);
  // Presence is guaranteed by the up-front guard in execute().
  const mappings = bulk.columnMappings!;
  const filters = bulk.filters ?? {};
  const compositeKey = bulk.compositeKey ?? [];
  const sourceSystem = inferSourceSystem(source);
  const headerSkip = bulk.headerLines ?? 0;

  let lineNum = 0;
  let colIndices: Record<string, number> = {};
  let filterIndices: Record<string, number> = {};
  let compositeIndices: number[] = [];

  const hasExplicitHeaders = bulk.headers && bulk.headers.length > 0;
  if (hasExplicitHeaders) {
    const headers = bulk.headers!;
    colIndices = buildColumnIndices(headers, mappings);
    filterIndices = buildColumnIndices(headers, filters);
    compositeIndices = buildCompositeIndices(headers, compositeKey);
  }

  const headerLineNum = headerSkip;

  const context = (): ParseContext => ({
    delimiter,
    mappings,
    filters,
    colIndices,
    filterIndices,
    compositeIndices,
    sourceSystem,
  });

  return {
    processLine(line: string): Record<string, unknown> | null {
      if (lineNum < headerSkip) {
        lineNum++;
        return null;
      }

      if (!hasExplicitHeaders && lineNum === headerLineNum) {
        const headers = line.split(delimiter).map((h) => stripQuotes(h));
        colIndices = buildColumnIndices(headers, mappings);
        filterIndices = buildColumnIndices(headers, filters);
        compositeIndices = buildCompositeIndices(headers, compositeKey);
        lineNum++;
        return null;
      }

      lineNum++;
      const record = processDataLine(line, context());

      // Hash the line, not the parsed record (#1277). The hash has to
      // witness what the export said rather than our interpretation of it —
      // that is what lets a discrepancy be audited after the fact (#991,
      // #992) instead of re-argued. Stamped here rather than at the two
      // parse call sites so streaming and accumulation cannot diverge.
      //
      // Filtered-out lines return null and are not hashed: nothing was
      // ingested, so there is no row whose provenance it would describe.
      return record === null
        ? null
        : { ...record, sourceRecordHash: hashSourceRecord(line) };
    },
  };
}

/**
 * Process a single data line: split, filter, map, inject sourceSystem.
 * Returns null if the line should be skipped.
 */
function processDataLine(
  line: string,
  ctx: ParseContext,
): Record<string, unknown> | null {
  if (!line.trim()) return null;

  const { compositeIndices, sourceSystem } = ctx;
  const values = line.split(ctx.delimiter);

  if (!passesFilters(values, ctx.filters, ctx.filterIndices)) return null;

  const record = mapRow(values, ctx.mappings, ctx.colIndices);

  if (compositeIndices.length > 0) {
    const segments = compositeIndices.map((idx) =>
      stripQuotes(values[idx] ?? ""),
    );
    // An all-empty key identifies nothing and would collide with every other
    // all-empty row, so drop the line rather than upserting them onto each other.
    if (segments.every((s) => !s)) return null;
    // Overwrites any externalId from columnMappings — a feed that needs a
    // composite key by definition has no single column that identifies a row.
    record["externalId"] = segments.join(COMPOSITE_KEY_SEPARATOR);
  }

  if (sourceSystem && !record["sourceSystem"]) {
    record["sourceSystem"] = sourceSystem;
  }

  const fieldCount = Object.keys(record).length;
  const minFields = sourceSystem ? 2 : 1;
  return fieldCount >= minFields ? record : null;
}

/**
 * Determine the column delimiter from the config.
 */
function getDelimiter(bulk: BulkDownloadConfig): string {
  if (bulk.delimiter) return bulk.delimiter;
  const format = bulk.format.replaceAll("zip_", "");
  return format === "tsv" ? "\t" : ",";
}

/**
 * Sanitize a CSV/TSV cell value: strip embedded NUL bytes (U+0000),
 * surrounding double quotes, and surrounding whitespace.
 *
 * NUL bytes appear in CalAccess TSVs (notably in committee names and
 * descriptions) and Postgres rejects them in UTF-8 text columns with
 * SQLSTATE 22021 ("invalid byte sequence for encoding UTF8: 0x00"),
 * which fails the entire batch transaction. We drop them here at the
 * parse layer so every downstream consumer (mapper, upsert, linker)
 * sees clean strings.
 */
function stripQuotes(val: string): string {
  return val
    .replaceAll("\u0000", "")
    .trim()
    .replaceAll(/(^"|"$)/g, "");
}

/**
 * Build a column-index lookup map from headers.
 * Logs warnings for mapped columns not found in the file.
 */
function buildColumnIndices(
  headers: string[],
  columns: Record<string, string>,
): Record<string, number> {
  const indices: Record<string, number> = {};
  for (const col of Object.keys(columns)) {
    const idx = headers.indexOf(col);
    if (idx === -1) {
      // Same reasoning as buildCompositeIndices: when the first line isn't
      // actually a header row it holds donor data, so log its shape, not its
      // cells (#980 review).
      logger.warn(
        `Column '${col}' not found in file headers (${headers.length} column(s) present).`,
      );
    } else {
      indices[col] = idx;
    }
  }
  return indices;
}

/**
 * Resolve `compositeKey` column names to their positions, in the order given.
 *
 * Throws on an unresolvable column instead of warning-and-continuing the way
 * {@link buildColumnIndices} does. A missing mapped column costs one field;
 * a missing key component silently shortens the key for *every* row, so
 * distinct rows collapse onto one `externalId` and the upsert discards all
 * but the last. That is the failure this feature exists to prevent
 * (opuspopuli#980), so it must be loud.
 */
function buildCompositeIndices(
  headers: string[],
  compositeKey: string[],
): number[] {
  const missing = compositeKey.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    // Report the shape of the header row, never its contents. `headers` is
    // just the file's first non-skipped line — and this error fires precisely
    // when that line ISN'T a header row, i.e. when it is a data row. Echoing
    // its cells would put donor name/employer/city/ZIP into an error-level log
    // that propagates to the persisted pipeline errors[] and on to Loki.
    throw new Error(
      `compositeKey column(s) not found in file headers: ${missing.join(", ")}. ` +
        `Header row has ${headers.length} column(s); ` +
        `expected columns are configured in the region plugin.`,
    );
  }
  return compositeKey.map((col) => headers.indexOf(col));
}

/**
 * Check if a row passes all filter criteria.
 */
function passesFilters(
  values: string[],
  filters: Record<string, string>,
  filterIndices: Record<string, number>,
): boolean {
  for (const [filterCol, filterVal] of Object.entries(filters)) {
    const idx = filterIndices[filterCol];
    if (idx === undefined) continue;
    const cellVal = stripQuotes(values[idx] ?? "");
    if (cellVal !== filterVal) return false;
  }
  return true;
}

/**
 * Map a row's values to a domain record using column mappings.
 */
function mapRow(
  values: string[],
  mappings: Record<string, string>,
  colIndices: Record<string, number>,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [sourceCol, targetField] of Object.entries(mappings)) {
    const idx = colIndices[sourceCol];
    if (idx === undefined) continue;
    const val = stripQuotes(values[idx] ?? "");
    if (val) record[targetField] = val;
  }
  return record;
}
