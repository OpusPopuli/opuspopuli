/**
 * Bulk Download Handler
 *
 * Downloads ZIP/CSV/TSV files, extracts target files from archives,
 * parses rows using column mappings, applies filters, and maps to domain types.
 *
 * No AI analysis needed — the schema is defined declaratively in the config.
 */

import { Injectable, Logger } from "@nestjs/common";
import AdmZip from "adm-zip";
import type {
  BulkDownloadConfig,
  DataSourceConfig,
  ExtractionResult,
  RawExtractionResult,
} from "@opuspopuli/common";
import { DomainMapperService } from "../mapping/domain-mapper.service.js";

@Injectable()
export class BulkDownloadHandler {
  private readonly logger = new Logger(BulkDownloadHandler.name);

  constructor(private readonly mapper: DomainMapperService) {}

  async execute<T>(
    source: DataSourceConfig,
    _regionId: string,
  ): Promise<ExtractionResult<T>> {
    const pipelineStart = Date.now();
    const bulk = source.bulk!;
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Download the file
      this.logger.log(`Downloading ${source.url}...`);
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(300_000), // 5 min timeout for large files
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      this.logger.log(
        `Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
      );

      // 2. Get the target file content
      let content: string;
      const isZip = bulk.format.startsWith("zip_");

      if (isZip) {
        content = this.extractFromZip(buffer, bulk);
      } else {
        content = buffer.toString("utf-8");
      }

      // 3. Parse delimited rows and apply column mappings + filters
      const delimiter = this.getDelimiter(bulk);
      const rawRecords = this.parseDelimited(content, delimiter, bulk, source);

      this.logger.log(
        `Parsed ${rawRecords.length} records from ${bulk.filePattern ?? source.url}`,
      );

      // 4. Map through domain mapper
      const rawResult: RawExtractionResult = {
        items: rawRecords,
        success: rawRecords.length > 0,
        warnings,
        errors,
      };

      const result = this.mapper.map<T>(rawResult, source);
      result.extractionTimeMs = Date.now() - pipelineStart;
      return result;
    } catch (error) {
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
  }

  /**
   * Extract a target file from a ZIP archive.
   */
  private extractFromZip(buffer: Buffer, bulk: BulkDownloadConfig): string {
    const pattern = bulk.filePattern;
    if (!pattern) {
      throw new Error("ZIP format requires filePattern in bulk config");
    }

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    // Find entry matching the file pattern (exact match or path suffix)
    const entry = entries.find(
      (e) =>
        e.entryName === pattern ||
        e.entryName.endsWith(`/${pattern}`) ||
        e.entryName.toUpperCase() === pattern.toUpperCase(),
    );

    if (!entry) {
      const available = entries
        .filter((e) => !e.isDirectory)
        .map((e) => e.entryName)
        .slice(0, 20)
        .join(", ");
      throw new Error(
        `File '${pattern}' not found in ZIP. Available: ${available}${entries.length > 20 ? "..." : ""}`,
      );
    }

    const uncompressedSize = entry.header.size;
    this.logger.log(
      `Extracting ${entry.entryName} (${(uncompressedSize / 1024 / 1024).toFixed(1)}MB uncompressed)`,
    );

    return entry.getData().toString("utf-8");
  }

  /**
   * Determine the column delimiter from the config.
   */
  private getDelimiter(bulk: BulkDownloadConfig): string {
    if (bulk.delimiter) return bulk.delimiter;
    const format = bulk.format.replaceAll("zip_", "");
    return format === "tsv" ? "\t" : ",";
  }

  /**
   * Strip surrounding double quotes and trim whitespace from a CSV cell value.
   */
  private static stripQuotes(val: string): string {
    return val.trim().replaceAll(/(^"|"$)/g, "");
  }

  /**
   * Build a column-index lookup map from headers.
   * Logs warnings for mapped columns not found in the file.
   */
  private buildColumnIndices(
    headers: string[],
    columns: Record<string, string>,
  ): Record<string, number> {
    const indices: Record<string, number> = {};
    for (const col of Object.keys(columns)) {
      const idx = headers.indexOf(col);
      if (idx === -1) {
        this.logger.warn(
          `Column '${col}' not found in file headers. Available: ${headers.slice(0, 10).join(", ")}`,
        );
      } else {
        indices[col] = idx;
      }
    }
    return indices;
  }

  /**
   * Check if a row passes all filter criteria.
   */
  private passesFilters(
    values: string[],
    filters: Record<string, string>,
    filterIndices: Record<string, number>,
  ): boolean {
    for (const [filterCol, filterVal] of Object.entries(filters)) {
      const idx = filterIndices[filterCol];
      if (idx === undefined) continue;
      const cellVal = BulkDownloadHandler.stripQuotes(values[idx] ?? "");
      if (cellVal !== filterVal) return false;
    }
    return true;
  }

  /**
   * Map a row's values to a domain record using column mappings.
   */
  private mapRow(
    values: string[],
    mappings: Record<string, string>,
    colIndices: Record<string, number>,
  ): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [sourceCol, targetField] of Object.entries(mappings)) {
      const idx = colIndices[sourceCol];
      if (idx === undefined) continue;
      const val = BulkDownloadHandler.stripQuotes(values[idx] ?? "");
      if (val) record[targetField] = val;
    }
    return record;
  }

  /**
   * Parse delimited text into records using column mappings.
   * Applies filters to skip irrelevant rows.
   */
  private parseDelimited(
    content: string,
    delimiter: string,
    bulk: BulkDownloadConfig,
    source: DataSourceConfig,
  ): Record<string, unknown>[] {
    const lines = content.split("\n");
    if (lines.length === 0) return [];

    // Get header line (skip any leading header lines as configured)
    const headerSkip = bulk.headerLines ?? 0;
    const headerLine = lines[headerSkip];
    if (!headerLine) return [];

    const headers = headerLine
      .split(delimiter)
      .map((h) => BulkDownloadHandler.stripQuotes(h));

    const mappings = bulk.columnMappings;
    const filters = bulk.filters ?? {};
    const colIndices = this.buildColumnIndices(headers, mappings);
    const filterIndices = this.buildColumnIndices(
      headers,
      filters as Record<string, string>,
    );
    const sourceSystem = this.inferSourceSystem(source);

    const records: Record<string, unknown>[] = [];

    for (let i = headerSkip + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line?.trim()) continue;

      const values = line.split(delimiter);

      if (!this.passesFilters(values, filters, filterIndices)) continue;

      const record = this.mapRow(values, mappings, colIndices);

      if (sourceSystem && !record["sourceSystem"]) {
        record["sourceSystem"] = sourceSystem;
      }

      const fieldCount = Object.keys(record).length;
      const minFields = sourceSystem ? 2 : 1;
      if (fieldCount >= minFields) {
        records.push(record);
      }
    }

    return records;
  }

  /**
   * Infer the sourceSystem value from the data source category.
   */
  private inferSourceSystem(source: DataSourceConfig): string | undefined {
    const cat = (source.category ?? "").toLowerCase();
    if (cat.includes("cal-access") || cat.includes("cal_access")) {
      return "cal_access";
    }
    if (cat.includes("fec")) return "fec";
    return undefined;
  }
}
