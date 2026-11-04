/**
 * DI token for the optional bulk-import ledger
 * (`docs/plans/campaign-finance-phase-b.md`, D3).
 *
 * Left unbound, no import is ever recorded as complete, so no row is ever
 * skipped: every sync writes every row, as before K4.
 */
export const BULK_IMPORT_LEDGER = "BULK_IMPORT_LEDGER";

/**
 * The last import of each bulk source that ran to completion, and the import
 * key it ran under (`bulkImportKey`).
 *
 * Rows may be skipped as unchanged only when the last completed import had
 * the key this one has. An import that dies partway never completes, so it
 * never licenses a skip: the next run writes every row again.
 *
 * Not completing is not enough on its own. A run under a new key that dies
 * partway has already rewritten rows under that key, so the old entry must go
 * before its first batch: otherwise a rollback to the old key would skip rows
 * the failed run wrote under the new one. See `forget`.
 *
 * An interface because `scraping-pipeline` must not learn about the database;
 * the implementation lives in the region service. Implementations must not
 * throw: an unreadable ledger means "nothing completed", which is the safe
 * answer, and a failed write only costs the next sync its skip.
 */
export interface IBulkImportLedger {
  lastCompletedKey(sourceKey: string): Promise<string | undefined>;
  recordCompleted(
    sourceKey: string,
    importKey: string,
    executionId: string | null,
  ): Promise<void>;
  /** Drop the source's entry, so nothing is skipped until one completes again. */
  forget(sourceKey: string): Promise<void>;
}
