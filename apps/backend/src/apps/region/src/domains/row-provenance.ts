import type { RowProvenance } from '@opuspopuli/common';

/** The provenance columns as Prisma writes them. */
export interface RowProvenanceColumns {
  pipelineExecutionId: string | null;
  manifestId: string | null;
  manifestVersion: number | null;
  /**
   * `undefined` means "leave the stored value alone" — Prisma omits an
   * undefined field from an update. See the note in `rowProvenance`.
   */
  sourceVersionId?: string | null;
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
export function rowProvenance(
  item: RowProvenance & { fullText?: string | null },
): RowProvenanceColumns {
  // `sourceVersionId` identifies the bytes `fullText` was derived from, so it
  // follows the text rather than the run (#1306).
  //
  // It cannot take the blanket explicit-null rule above. Two dataSources are
  // allowed to write one row — Sonoma's ballot measures are named by a filings
  // page and documented by a voter-guide page, merged on `externalId` — and
  // they are concatenated in config order, so the second one upserts last. A
  // write that carries no text has nothing to say about which bytes the text
  // came from, and nulling the pointer there discards a correct reference: on
  // 2026-10-12 it orphaned all 15 archived Sonoma guides, leaving 15
  // `source_versions` rows that nothing referenced.
  //
  // The original intent survives intact, because the only case it was about is
  // a write that DOES carry text: new text with no archived bytes still clears
  // the stale pointer. And when no text is written the retained pointer is not
  // stale — the text it describes is exactly the text still stored.
  const writesText = item.fullText !== undefined && item.fullText !== null;

  return {
    pipelineExecutionId: item.pipelineExecutionId ?? null,
    manifestId: item.manifestId ?? null,
    manifestVersion: item.manifestVersion ?? null,
    sourceVersionId: item.sourceVersionId ?? (writesText ? null : undefined),
  };
}
