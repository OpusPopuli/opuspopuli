import type { RowProvenance } from '@opuspopuli/common';

/** The provenance columns as Prisma writes them. */
export interface RowProvenanceColumns {
  pipelineExecutionId: string | null;
  manifestId: string | null;
  manifestVersion: number | null;
  sourceVersionId: string | null;
}

/**
 * Map the provenance an item carried out of the pipeline onto the columns
 * that record which run produced a row (#1280).
 *
 * Absent values are written as explicit nulls rather than omitted. On an
 * upsert an omitted field leaves whatever was there before, so a row rewritten
 * by an untracked run would keep pointing at the last *tracked* run that
 * touched it — a stale reference that reads as current, which is worse than
 * no reference at all.
 *
 * @param item - Item as returned by the pipeline
 * @returns Columns ready to spread into a Prisma create/update
 */
export function rowProvenance(item: RowProvenance): RowProvenanceColumns {
  return {
    pipelineExecutionId: item.pipelineExecutionId ?? null,
    manifestId: item.manifestId ?? null,
    manifestVersion: item.manifestVersion ?? null,
    // Stamped per item at the detail fetch rather than per run (#1306), but
    // written under the same explicit-null rule: a row rewritten from an
    // unarchived fetch must stop pointing at the bytes of an earlier one.
    sourceVersionId: item.sourceVersionId ?? null,
  };
}
