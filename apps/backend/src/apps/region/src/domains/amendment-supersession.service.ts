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
    // Bounded rather than `while (true)`: the exit depends on a value the
    // database returns, and a driver answering oddly should not spin forever.
    const maxBatches =
      Math.ceil((filingsAffected * 50) / DELETE_BATCH_SIZE) + 10;
    for (let i = 0; i < maxBatches; i++) {
      const removed = await this.deleteBatch(table);
      if (!removed) break;
      superseded += removed;
    }

    this.logger.log(
      `Amendment supersession (${table}): removed ${superseded} superseded row(s) ` +
        `across ${filingsAffected} amended filing(s)`,
    );
    return { superseded, filingsAffected };
  }

  /**
   * Filings carrying more than one amendment version. Used both to skip the
   * work entirely when there is none, and to bound the batch loop.
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
