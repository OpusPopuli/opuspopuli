import { stableHash, type DataSourceConfig } from "@opuspopuli/common";

/**
 * Bumped whenever a change could alter what a bulk export line becomes in the
 * database: the line parser and mapper here, or what the campaign-finance sync
 * writes per table. A bump changes every source's import key, so the next
 * sync rewrites every row once instead of skipping rows whose line is
 * unchanged (`docs/plans/campaign-finance-phase-b.md`, D2).
 *
 * Pinned twice, so neither change can ship without a bump:
 * `__tests__/bulk-import-key.spec.ts` against the line parser and mapper
 * source, and the backend's `campaign-finance-write-shape.spec.ts` against the
 * sync's write shape and the finance routing.
 */
export const BULK_MAPPING_VERSION = "bm1";

/**
 * What a bulk import's rows were written under: the mapping version, and the
 * source config that shapes a mapped row (D2). Two imports with the same key
 * turn the same line into the same row, so an unchanged line can be skipped.
 */
export function bulkImportKey(source: DataSourceConfig): string {
  return stableHash({
    mapping: BULK_MAPPING_VERSION,
    dataType: source.dataType,
    category: source.category ?? null,
    bulk: source.bulk ?? null,
  });
}
