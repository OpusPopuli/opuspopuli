import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

export interface CoverPageLinkTableResult {
  /** Unattributed rows with a filingId considered this run. */
  considered: number;
  /** Rows stamped with a resolved committee this run. */
  linked: number;
  /** Still unresolved: no cover page for the filingId. */
  skippedNoCoverPage: number;
  /** Cover page found, but its FILER_ID matches no committee row. */
  skippedNoCommittee: number;
}

export interface CoverPageLinkResult {
  contributions: CoverPageLinkTableResult;
  expenditures: CoverPageLinkTableResult;
}

/**
 * The two tables this linker attributes. Declared as a const tuple because the
 * table name is interpolated into SQL (an identifier, which cannot be bound as
 * a parameter) — so the only values that can ever reach the statement are these
 * two compile-time literals, never anything derived from data or user input.
 */
const LINKED_TABLES = ['contributions', 'expenditures'] as const;
type LinkedTable = (typeof LINKED_TABLES)[number];

/**
 * Rows attributed per transaction. Bounds WAL, lock duration and dead-tuple
 * churn on the first post-rebuild run without making the ~1.2M-row backfill
 * take a meaningfully different amount of total work.
 */
const LINK_BATCH_SIZE = 50_000;

const EMPTY_TABLE_RESULT: CoverPageLinkTableResult = {
  considered: 0,
  linked: 0,
  skippedNoCoverPage: 0,
  skippedNoCommittee: 0,
};

/**
 * Attribute contributions and expenditures to the committee that FILED them (#980).
 *
 * CAL-ACCESS `RCPT_CD` and `EXPN_CD` line items carry no `FILER_ID`, and their
 * `CMTE_ID` names the *counterparty* — the contributor on a receipt, the payee
 * on an expenditure — not the filer. The filer lives on the campaign-disclosure
 * cover page (`CVR_CAMPAIGN_DISCLOSURE_CD`), which the sync persists to
 * `cvr_filings`. Each row is ingested with a null `committeeId` + its
 * `filingId`; this linker joins
 * `filingId → CvrFiling.filingId → CvrFiling.filerId → Committee.externalId`
 * and stamps the committee.
 *
 * Same join as {@link IndependentExpenditureLinkerService} (#955), but set-based
 * rather than row-by-row. That linker builds one `update()` per pending row for
 * `batchTransaction`, which is fine for tens of thousands of IEs; contributions
 * reach ~1.2M rows, where the same shape would mean 1.2M promises across ~2,400
 * transactions. A single `UPDATE … FROM` does it in one statement per table.
 *
 * Post-sync and idempotent: only rows with `committeeId IS NULL` are touched, so
 * re-running never rewrites or unlinks an already-attributed row. Must run
 * BEFORE `PropositionFinanceLinkerService` so the committees it stamps are
 * visible when measure positions are derived.
 */
@Injectable()
export class CoverPageLinkerService {
  private readonly logger = new Logger(CoverPageLinkerService.name);

  constructor(@Optional() private readonly db?: DbService) {}

  async linkAll(): Promise<CoverPageLinkResult> {
    if (!this.db) {
      return {
        contributions: { ...EMPTY_TABLE_RESULT },
        expenditures: { ...EMPTY_TABLE_RESULT },
      };
    }

    const [contributions, expenditures] = await Promise.all(
      LINKED_TABLES.map((table) => this.linkTable(table)),
    );

    return { contributions, expenditures };
  }

  /**
   * Resolve one table, in bounded batches.
   *
   * `cvr_filings.filing_id` is `@unique`, so exactly one cover page exists per
   * filing and the join cannot fan out. (That constraint is load-bearing, not
   * decorative — without it the UPDATE would pick an arbitrary filer.)
   *
   * Batched rather than one statement: the first post-rebuild run faces ~1.2M
   * unattributed rows, and a single transaction there means multi-GB of WAL,
   * ~1.2M dead tuples across seven indexes, and a lock held for the whole build.
   * Worse, any statement timeout rolls the entire thing back and the next sync
   * restarts from zero. Batching costs the same total work but is resumable,
   * bounds each transaction, and reports progress. Steady-state runs resolve a
   * handful of rows and exit after one iteration.
   */
  private async linkTable(
    table: LinkedTable,
  ): Promise<CoverPageLinkTableResult> {
    const considered = await this.countUnattributed(table);
    if (considered === 0) return { ...EMPTY_TABLE_RESULT };

    // Bounded rather than `while (true)`: the loop's exit depends on a value
    // the database returns, so a driver that ever answered with something
    // non-numeric would spin forever inside a sync. `+2` covers the final
    // zero-row probe and any rows inserted while we run.
    const maxBatches = Math.ceil(considered / LINK_BATCH_SIZE) + 2;
    let linked = 0;
    for (let i = 0; i < maxBatches; i++) {
      const batch = await this.linkBatch(table);
      if (!batch) break;
      linked += batch;
      if (linked < considered) {
        this.logger.debug(
          `Cover-page linker (${table}): ${linked}/${considered}`,
        );
      }
    }

    const result = {
      ...EMPTY_TABLE_RESULT,
      considered,
      linked,
      // max(0): `considered` is counted before the UPDATE, so a concurrent
      // insert could otherwise drive this negative.
      ...(await this.explainRemaining(table, Math.max(0, considered - linked))),
    };

    this.logger.log(
      `Cover-page linker (${table}): linked=${result.linked} ` +
        `noCoverPage=${result.skippedNoCoverPage} ` +
        `noCommittee=${result.skippedNoCommittee} (of ${considered} unattributed)`,
    );

    return result;
  }

  /**
   * Attribute up to {@link LINK_BATCH_SIZE} rows; returns how many were stamped.
   *
   * The subquery re-applies the full join rather than just filtering on
   * `committee_id IS NULL`. That matters: rows whose filing has no cover page,
   * or whose filer matches no committee, are legitimately unresolvable. If the
   * batch could select those, a batch made up entirely of them would update 0
   * rows and end the loop while resolvable rows remained further along — a
   * silent partial link. Selecting only rows that *will* resolve means a
   * short batch can only mean "nothing left to do".
   */
  private async linkBatch(table: LinkedTable): Promise<number> {
    return this.db!.$executeRawUnsafe(
      `UPDATE "${table}" AS t
          SET "committee_id" = c."id",
              "updated_at"   = NOW()
         FROM "cvr_filings" AS f
         JOIN "committees"  AS c
           ON c."external_id" = f."filer_id"
          AND c."deleted_at" IS NULL
        WHERE t."ctid" IN (
                SELECT s."ctid"
                  FROM "${table}" AS s
                  JOIN "cvr_filings" AS sf ON sf."filing_id" = s."filing_id"
                  JOIN "committees"  AS sc
                    ON sc."external_id" = sf."filer_id"
                   AND sc."deleted_at" IS NULL
                 WHERE s."committee_id" IS NULL
                   AND s."filing_id" IS NOT NULL
                 LIMIT ${LINK_BATCH_SIZE}
              )
          AND t."committee_id" IS NULL
          AND f."filing_id" = t."filing_id"`,
    );
  }

  private async countUnattributed(table: LinkedTable): Promise<number> {
    // Branch rather than hold the delegate in a variable: the union of Prisma's
    // two count() overload sets has no callable signature.
    const where = { committeeId: null, filingId: { not: null } };
    return table === 'contributions'
      ? this.db!.contribution.count({ where })
      : this.db!.expenditure.count({ where });
  }

  /**
   * Split the rows the UPDATE did not reach into "no cover page" vs "cover page
   * but no committee". Only runs when something was actually left behind, so the
   * common fully-resolved case costs nothing.
   */
  private async explainRemaining(
    table: LinkedTable,
    remaining: number,
  ): Promise<
    Pick<CoverPageLinkTableResult, 'skippedNoCoverPage' | 'skippedNoCommittee'>
  > {
    if (remaining <= 0) {
      return { skippedNoCoverPage: 0, skippedNoCommittee: 0 };
    }

    // EXISTS, not JOIN: a join would count (row, cover page) pairs rather than
    // rows, so any fan-out would make hadCoverPage exceed `remaining` and drive
    // skippedNoCoverPage negative. The unique constraint on cvr_filings.filing_id
    // should prevent that; this is the belt to its braces.
    const rows = await this.db!.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM "${table}" AS t
        WHERE t."committee_id" IS NULL
          AND t."filing_id" IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM "cvr_filings" AS f
                 WHERE f."filing_id" = t."filing_id"
              )`,
    );
    const hadCoverPage = Number(rows[0]?.count ?? 0);

    return {
      skippedNoCoverPage: remaining - hadCoverPage,
      skippedNoCommittee: hadCoverPage,
    };
  }
}
