import { stableHash, type DataSourceConfig } from "@opuspopuli/common";

/**
 * Bumped whenever a change could alter what a bulk export line becomes in the
 * database: the line parser and mapper here, what the campaign-finance sync
 * writes per table, or what the bills sync writes and derives from the pubinfo
 * mirrors. A bump changes every source's import key, so the next
 * sync rewrites every row once instead of skipping rows whose line is
 * unchanged (`docs/plans/campaign-finance-phase-b.md`, D2).
 *
 * Pinned twice, so neither change can ship without a bump:
 * `__tests__/bulk-import-key.spec.ts` against the line parser and mapper
 * source, and the backend's `campaign-finance-write-shape.spec.ts` against the
 * sync's write shape, the finance routing, and the bills mirror write and
 * derive.
 *
 * bm2: the bills derive keeps same-day roll calls apart and breaks a tied
 * history sequence by id (bills-phase-b.md, UAT run 1).
 * bm3: lob text is resolved under the pin, an empty entry reads as empty, and
 * the bills derive links a vote only to the member holding the seat (review
 * of the final diff).
 */
export const BULK_MAPPING_VERSION = "bm3";

/**
 * What a bulk import's rows were written under: the mapping version, and the
 * source config that shapes a mapped row (D2). Two imports with the same key
 * turn the same line into the same row, so an unchanged line can be skipped.
 * `billStatusLifecycle` is included because a bill's flags are derived from
 * it: a changed map must reach bills whose lines did not change.
 */
export function bulkImportKey(source: DataSourceConfig): string {
  return stableHash({
    mapping: BULK_MAPPING_VERSION,
    dataType: source.dataType,
    category: source.category ?? null,
    bulk: source.bulk ?? null,
    billStatusLifecycle: source.billStatusLifecycle ?? null,
  });
}
