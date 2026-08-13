import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

export interface SupersessionTableResult {
  /** Rows removed because a higher amend_id exists for the same filing. */
  superseded: number;
  /** Filings that carried more than one amendment version. */
  filingsAffected: number;
}

export interface SupersessionResult {
  contributions: SupersessionTableResult;
  expenditures: SupersessionTableResult;
}

/**
 * The two tables carrying amendable line items. A const tuple because the table
 * name is interpolated into SQL (identifiers cannot be bound), so the only
 * values reaching the statement are these compile-time literals.
 */
const AMENDABLE_TABLES = ['contributions', 'expenditures'] as const;
type AmendableTable = (typeof AMENDABLE_TABLES)[number];

/**
 * Rows removed per transaction. Bounds WAL and lock duration on the first run
 * after a rebuild, where the affected set is largest.
 */
const DELETE_BATCH_SIZE = 25_000;

const EMPTY: SupersessionTableResult = { superseded: 0, filingsAffected: 0 };

/**
 * Drop superseded versions of amended filings (#992).
 *
 * CAL-ACCESS does not patch a filing when it is amended — it restates the whole
 * schedule, using **new** `TRAN_ID` and `LINE_ITEM` values. The composite
 * `externalId` (`FILING_ID:LINE_ITEM:TRAN_ID`) therefore cannot merge the
 * versions, and both survive ingest:
 *
 * ```
 * filing 2505994
 *   AMEND_ID 0:  1 row,  $168,135.00
 *   AMEND_ID 1:  2 rows, $170,988.25   <- official Form 460 line 1
 *   stored:      3 rows, $339,123.25
 * ```
 *
 * Measured on the #980 rebuild: 8 of 123 sampled filings (7%) over-counted this
 * way, typically at ~2x the committee's own reported total.
 *
 * Only the highest `amend_id` per filing is retained. `amend_id` is an integer
 * precisely so that comparison is numeric — under text ordering `'10' < '9'`
 * and this would keep the wrong version while reporting success.
 *
 * **Runs before the cover-page linker** — attributing rows that are about to be
 * deleted is wasted work, and the counts it reports would be misleading.
 *
 * Idempotent: a second run finds nothing above the maximum and deletes nothing.
 */
@Injectable()
export class AmendmentSupersessionService {
  private readonly logger = new Logger(AmendmentSupersessionService.name);

  constructor(@Optional() private readonly db?: DbService) {}

  async supersedeAll(): Promise<SupersessionResult> {
    if (!this.db) {
      return { contributions: { ...EMPTY }, expenditures: { ...EMPTY } };
    }

    const [contributions, expenditures] = await Promise.all(
      AMENDABLE_TABLES.map((t) => this.supersedeTable(t)),
    );
    return { contributions, expenditures };
  }

  private async supersedeTable(
    table: AmendableTable,
  ): Promise<SupersessionTableResult> {
    const filingsAffected = await this.countAffectedFilings(table);
    if (filingsAffected === 0) return { ...EMPTY };

    let superseded = 0;
    // The loop is still bounded — an exit condition that depends on what the
    // database returns should not be able to spin forever if a driver answers
    // oddly. But the bound is a SAFETY VALVE, not a work estimate.
    //
    // It used to be `ceil((filingsAffected * 50) / DELETE_BATCH_SIZE) + 10`,
    // which guessed at most 50 superseded rows per filing. On the 2026-08-13
    // rebuild the real figure was ~256, so the loop ran out of iterations with
    // 2,014,849 rows still to delete, and returned — reporting success (#997).
    // Every filing it abandoned then over-counted on the public totals.
    //
    // Derived from rows now, not filings: at most one batch per batch-sized
    // slice of the table, doubled. No dataset can legitimately need more, and
    // nothing about the data's shape can make it too small.
    const tableRows = await this.countRows(table);
    const maxBatches = Math.ceil(tableRows / DELETE_BATCH_SIZE) * 2 + 10;

    let exhausted = true;
    for (let i = 0; i < maxBatches; i++) {
      const removed = await this.deleteBatch(table);
      if (!removed) {
        exhausted = false;
        break;
      }
      superseded += removed;
    }

    // Hitting the cap means the loop stopped early. Verify against the database
    // rather than trusting the counter: silence here is what made #997 invisible
    // for a whole rebuild — the log said "removed 800000" and read like success.
    if (exhausted) {
      const remaining = await this.countSupersededRows(table);
      if (remaining > 0) {
        throw new Error(
          `Amendment supersession (${table}) stopped after ${maxBatches} batches ` +
            `with ${remaining} superseded row(s) still present. Totals for the ` +
            `affected filings are inflated until this completes. Re-run it — the ` +
            `step is idempotent and needs no re-sync.`,
        );
      }
    }

    this.logger.log(
      `Amendment supersession (${table}): removed ${superseded} superseded row(s) ` +
        `across ${filingsAffected} amended filing(s)`,
    );
    return { superseded, filingsAffected };
  }

  /** Total rows, used only to size the loop's safety valve. */
  private async countRows(table: AmendableTable): Promise<number> {
    const rows = await this.db!.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Rows a later amendment supersedes — i.e. what a completed run must leave at
   * zero. Deliberately re-derived from the database instead of inferred from
   * the delete counter, because the counter is exactly what lied in #997.
   */
  private async countSupersededRows(table: AmendableTable): Promise<number> {
    const rows = await this.db!.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM "${table}" r
         JOIN (
           SELECT "filing_id", MAX("amend_id") AS latest
             FROM "${table}"
            WHERE "filing_id" IS NOT NULL AND "amend_id" IS NOT NULL
            GROUP BY "filing_id"
         ) m ON m."filing_id" = r."filing_id"
        WHERE r."amend_id" IS NOT NULL AND r."amend_id" < m."latest"`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Filings carrying more than one amendment version. Used both to skip the
   * work entirely when there is none, and for the reported count.
   */
  private async countAffectedFilings(table: AmendableTable): Promise<number> {
    const rows = await this.db!.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM (
         SELECT "filing_id"
           FROM "${table}"
          WHERE "filing_id" IS NOT NULL AND "amend_id" IS NOT NULL
          GROUP BY "filing_id"
         HAVING COUNT(DISTINCT "amend_id") > 1
       ) t`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Remove up to {@link DELETE_BATCH_SIZE} rows that a later amendment
   * superseded.
   *
   * The subquery compares each row's `amend_id` against the maximum for its own
   * filing, so a filing with a single amendment can never match: its only
   * version *is* the maximum. That property is what keeps this from deleting
   * live data, and it is asserted directly in the integration tests.
   */
  private async deleteBatch(table: AmendableTable): Promise<number> {
    return this.db!.$executeRawUnsafe(
      `DELETE FROM "${table}"
        WHERE "ctid" IN (
          SELECT r."ctid"
            FROM "${table}" r
            JOIN (
              SELECT "filing_id", MAX("amend_id") AS latest
                FROM "${table}"
               WHERE "filing_id" IS NOT NULL AND "amend_id" IS NOT NULL
               GROUP BY "filing_id"
            ) m ON m."filing_id" = r."filing_id"
           WHERE r."amend_id" IS NOT NULL
             AND r."amend_id" < m."latest"
           LIMIT ${DELETE_BATCH_SIZE}
        )`,
    );
  }
}
