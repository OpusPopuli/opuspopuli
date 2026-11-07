/**
 * The per-row skip of a bulk import (K4): which incoming rows can be left
 * unwritten because the stored row came from the identical export line.
 * Shared by every bulk sync, so the rule lives in one place
 * (`campaign-finance-phase-b.md` K4, `bills-phase-b.md` D10).
 */

/**
 * The rows whose line differs from the one the stored row was written from
 * (K4). A row is unchanged only when both hashes exist and match: a stored row
 * with no hash predates F3's fix and is written, which records its hash.
 *
 * Only called when the handler vouches that the last completed import of this
 * source ran under the same import key, so an equal line maps to an equal row.
 *
 * A key that arrives on more than one line in the batch is never skipped. The
 * non-amendable tables key cover pages by FILING_ID alone, one line per
 * amendment, so a batch can hold two lines for one row and the last one wins.
 * Skipping the line that matches the stored row (the last one, from the
 * previous sync) while writing the other would leave the earlier line's data
 * in place: on UAT run 2 that was 21,061 cover pages. Writing every line keeps
 * the result identical to the sync without K4.
 *
 * Lines for one key in different batches need no guard: each batch reads the
 * stored rows after the previous batch committed, so a later line is compared
 * with the earlier line this sync just wrote, not with the previous sync's.
 */
export function withoutUnchanged(
  rows: Record<string, unknown>[],
  existing: { externalId: string; sourceRecordHash?: string | null }[],
): Record<string, unknown>[] {
  const stored = new Map(
    existing.map((r) => [r.externalId, r.sourceRecordHash ?? null]),
  );
  const lines = new Map<string, number>();
  for (const row of rows) {
    const id = row.externalId as string;
    lines.set(id, (lines.get(id) ?? 0) + 1);
  }
  return rows.filter((row) => {
    const id = row.externalId as string;
    const hash = row.sourceRecordHash;
    return !(
      lines.get(id) === 1 &&
      typeof hash === 'string' &&
      stored.get(id) === hash
    );
  });
}
