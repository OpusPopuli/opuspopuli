import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Verdict for one side (contributions or expenditures) of one filing.
 *
 * `UNITEMIZED` and `OVER_ITEMIZED` are the two readings of the same arithmetic,
 * and keeping them apart is the reason this table exists — one is the source
 * behaving normally, the other is us being wrong.
 *
 * Constants rather than bare string literals because each value appears in
 * three places — this union, the classifying SQL, and the summary query. Bare
 * literals let those drift silently: rename one and the check still runs, still
 * reports success, and counts nothing.
 */
export const RECONCILIATION_STATUS = {
  /** Detail equals the reported total, to the cent. */
  MATCH: 'MATCH',
  /** Detail is BELOW reported. Expected: the gap is money under the $100
   *  itemization threshold, which appears only on the summary page. */
  UNITEMIZED: 'UNITEMIZED',
  /** Detail EXCEEDS reported. A fault — we are counting money the committee
   *  never reported. This is the condition the check exists to catch. */
  OVER_ITEMIZED: 'OVER_ITEMIZED',
  /** The filing has no summary line to compare against. */
  NO_SUMMARY: 'NO_SUMMARY',
  /** A total was reported but no detail rows were stored for that schedule. */
  NO_DETAIL: 'NO_DETAIL',
  /** Detail rows exist but carry no schedule, so they cannot be attributed to
   *  a summary line. Declines to guess rather than reconciling wrongly. */
  UNKNOWN_SCHEDULE: 'UNKNOWN_SCHEDULE',
} as const;

export type ReconciliationStatus =
  (typeof RECONCILIATION_STATUS)[keyof typeof RECONCILIATION_STATUS];

export interface ReconciliationSummary {
  /** Filings written. */
  reconciled: number;
  /** Filings whose detail exceeds the committee's own reported contributions. */
  overItemizedContributions: number;
  /** Same, for expenditures — the independent check #991 lacks. */
  overItemizedExpenditures: number;
  /** Filings carrying unitemized (<$100) contributions. */
  withUnitemized: number;
  /** Total unitemized contribution money made visible. */
  unitemizedTotal: number;
  /** Filings skipped because their detail rows carry no schedule. */
  unknownSchedule: number;
}

/**
 * Form 460 summary lines this reconciles against.
 *
 * Line 1 is monetary contributions and pairs with Schedule A. Line 6 is
 * payments made and pairs with Schedule E. The pairing is exact and it matters:
 * `RCPT_CD` and `EXPN_CD` each hold every schedule for their side, so summing a
 * file wholesale compares a mixture against one of its parts (#992).
 */
const CONTRIBUTION_LINE = '1';
const CONTRIBUTION_SCHEDULE = 'A';
const EXPENDITURE_LINE = '6';
/**
 * Schedule E alone. Schedule D is a MEMO schedule — it itemizes payments
 * supporting or opposing candidates and measures that Schedule E has already
 * counted, so adding it double-counts ~4.8M rows.
 */
const EXPENDITURE_SCHEDULE = 'E';

/** Cent tolerance. The source rounds to cents; anything inside this is a match. */
const TOLERANCE = 0.01;

const EMPTY: ReconciliationSummary = {
  reconciled: 0,
  overItemizedContributions: 0,
  overItemizedExpenditures: 0,
  withUnitemized: 0,
  unitemizedTotal: 0,
  unknownSchedule: 0,
};

/**
 * Reconcile stored itemized detail against each filing's own Form 460 summary
 * (#992, subtask 4b).
 *
 * Comparing our sums against the committee's reported totals is what found the
 * amendment double-count in the first place. Run every sync, it stops being a
 * manual exercise and becomes a standing property: if a future change starts
 * counting money twice, `OVER_ITEMIZED` rises and says so.
 *
 * It also makes unitemized money visible. Schedule A itemizes only
 * contributions of $100 or more, so smaller donations live nowhere but the
 * summary page — 59% of filings report more than they itemize. Left
 * unrecorded, a candidate funded by many small donors reads as less funded
 * than one funded by a few large ones.
 *
 * **Runs last** among the post-sync steps: supersession must have removed
 * stale amendments and the cover-page linker must have stamped `committeeId`,
 * or this would reconcile rows that are about to vanish and attribute the
 * result to nobody.
 *
 * Set-based and idempotent — one statement over the whole corpus, upserting on
 * `filing_id`, mirroring `AmendmentSupersessionService`.
 */
@Injectable()
export class FilingReconciliationService {
  private readonly logger = new Logger(FilingReconciliationService.name);

  constructor(@Optional() private readonly db?: DbService) {}

  async reconcileAll(): Promise<ReconciliationSummary> {
    if (!this.db) return { ...EMPTY };

    await this.db.$executeRawUnsafe(this.buildReconciliationSql());
    const summary = await this.summarise();

    this.logger.log(
      `Filing reconciliation: ${summary.reconciled} filing(s); ` +
        `${summary.overItemizedContributions} over-itemized contributions, ` +
        `${summary.overItemizedExpenditures} over-itemized expenditures; ` +
        `${summary.withUnitemized} filing(s) carry ` +
        `$${summary.unitemizedTotal.toFixed(2)} of unitemized contributions`,
    );

    if (summary.overItemizedContributions > 0) {
      this.logger.warn(
        `${summary.overItemizedContributions} filing(s) itemize MORE ` +
          `contributions than the committee reported. Detail exceeding the ` +
          `source is a fault, not a source quirk — inspect ` +
          `filing_reconciliations WHERE contribution_status = 'OVER_ITEMIZED'.`,
      );
    }
    if (summary.unknownSchedule > 0) {
      this.logger.warn(
        `${summary.unknownSchedule} filing(s) skipped: detail rows carry no ` +
          `schedule_code. Expected only for rows ingested before #992's ` +
          `mapping; a re-sync populates them.`,
      );
    }

    return summary;
  }

  /**
   * One statement: aggregate both sides per filing, classify, upsert.
   *
   * Driven from `filing_summaries` rather than from the detail tables, so a
   * filing whose detail we failed to ingest still gets a row — silence about a
   * filing we never stored would be indistinguishable from a clean bill.
   */
  private buildReconciliationSql(): string {
    return `
      WITH latest AS (
        SELECT "filing_id", MAX("amend_id") AS amend_id
          FROM "filing_summaries"
         WHERE "form_type" = 'F460'
         GROUP BY "filing_id"
      ),
      reported AS (
        SELECT l."filing_id",
               l.amend_id,
               MAX(CASE WHEN s."line_item" = '${CONTRIBUTION_LINE}'
                        THEN s."amount_a" END) AS reported_contributions,
               MAX(CASE WHEN s."line_item" = '${EXPENDITURE_LINE}'
                        THEN s."amount_a" END) AS reported_expenditures
          FROM latest l
          JOIN "filing_summaries" s
            ON s."filing_id" = l."filing_id"
           AND s."amend_id" IS NOT DISTINCT FROM l.amend_id
           AND s."form_type" = 'F460'
         GROUP BY l."filing_id", l.amend_id
      ),
      -- COUNT(*) alongside the filtered SUM so "no Schedule A rows" can be told
      -- apart from "rows exist but none carry a schedule". The first is a real
      -- finding; the second means we simply cannot judge this filing.
      detail_c AS (
        SELECT "filing_id",
               SUM("amount") FILTER (
                 WHERE "schedule_code" = '${CONTRIBUTION_SCHEDULE}') AS amt,
               COUNT(*) FILTER (WHERE "schedule_code" IS NOT NULL) AS coded,
               COUNT(*) AS total,
               MIN("committee_id") FILTER (
                 WHERE "committee_id" IS NOT NULL) AS committee_id
          FROM "contributions"
         WHERE "filing_id" IS NOT NULL
         GROUP BY "filing_id"
      ),
      detail_e AS (
        SELECT "filing_id",
               SUM("amount") FILTER (
                 WHERE "schedule_code" = '${EXPENDITURE_SCHEDULE}') AS amt,
               COUNT(*) FILTER (WHERE "schedule_code" IS NOT NULL) AS coded,
               COUNT(*) AS total,
               MIN("committee_id") FILTER (
                 WHERE "committee_id" IS NOT NULL) AS committee_id
          FROM "expenditures"
         WHERE "filing_id" IS NOT NULL
         GROUP BY "filing_id"
      )
      INSERT INTO "filing_reconciliations" (
        "id", "filing_id", "amend_id", "committee_id",
        "reported_contributions", "itemized_contributions",
        "unitemized_contributions", "contribution_status",
        "reported_expenditures", "itemized_expenditures", "expenditure_status",
        "reconciled_at", "created_at", "updated_at"
      )
      SELECT gen_random_uuid()::text,
             r."filing_id",
             r.amend_id,
             COALESCE(c.committee_id, e.committee_id),

             r.reported_contributions,
             ${this.itemizedExpr('c')},
             ${this.unitemizedExpr('r.reported_contributions', 'c')},
             ${this.statusExpr('r.reported_contributions', 'c')},

             r.reported_expenditures,
             ${this.itemizedExpr('e')},
             ${this.statusExpr('r.reported_expenditures', 'e')},

             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM reported r
        LEFT JOIN detail_c c ON c."filing_id" = r."filing_id"
        LEFT JOIN detail_e e ON e."filing_id" = r."filing_id"
      ON CONFLICT ("filing_id") DO UPDATE SET
        "amend_id"                 = EXCLUDED."amend_id",
        "committee_id"             = EXCLUDED."committee_id",
        "reported_contributions"   = EXCLUDED."reported_contributions",
        "itemized_contributions"   = EXCLUDED."itemized_contributions",
        "unitemized_contributions" = EXCLUDED."unitemized_contributions",
        "contribution_status"      = EXCLUDED."contribution_status",
        "reported_expenditures"    = EXCLUDED."reported_expenditures",
        "itemized_expenditures"    = EXCLUDED."itemized_expenditures",
        "expenditure_status"       = EXCLUDED."expenditure_status",
        "reconciled_at"            = CURRENT_TIMESTAMP,
        "updated_at"               = CURRENT_TIMESTAMP
    `;
  }

  /**
   * Classify one side of one filing.
   *
   * Order is deliberate. "Rows exist but carry no schedule" is checked before
   * any arithmetic, because under that condition the filtered sum is 0 and
   * every comparison below would read as "the committee reported money we did
   * not itemize" — a confident, wrong answer instead of an admission.
   */
  private statusExpr(reported: string, d: string): string {
    const S = RECONCILIATION_STATUS;
    return `CASE
      WHEN ${reported} IS NULL THEN '${S.NO_SUMMARY}'
      WHEN COALESCE(${d}.total, 0) > 0 AND COALESCE(${d}.coded, 0) = 0
        THEN '${S.UNKNOWN_SCHEDULE}'
      WHEN ${d}.amt IS NULL AND ${reported} <> 0 THEN '${S.NO_DETAIL}'
      WHEN COALESCE(${d}.amt, 0) > ${reported} + ${TOLERANCE}
        THEN '${S.OVER_ITEMIZED}'
      WHEN COALESCE(${d}.amt, 0) < ${reported} - ${TOLERANCE}
        THEN '${S.UNITEMIZED}'
      ELSE '${S.MATCH}'
    END`;
  }

  /**
   * The itemized sum — NULL, not 0, when the rows carry no schedule.
   *
   * Zero is a claim: "this filing itemized nothing". For a filing we have
   * explicitly declined to judge it is a false one, and it would quietly poison
   * any SUM over this column. NULL says what is actually true — we do not know.
   */
  private itemizedExpr(d: string): string {
    return `CASE
      WHEN COALESCE(${d}.total, 0) > 0 AND COALESCE(${d}.coded, 0) = 0 THEN NULL
      ELSE COALESCE(${d}.amt, 0)
    END`;
  }

  /**
   * The unitemized gap, recorded only where it is genuinely that: a positive
   * shortfall against a schedule we could actually read. Left NULL otherwise,
   * so an unreadable filing never contributes to a "small-donor money" figure.
   */
  private unitemizedExpr(reported: string, d: string): string {
    return `CASE
      WHEN ${reported} IS NULL THEN NULL
      WHEN COALESCE(${d}.total, 0) > 0 AND COALESCE(${d}.coded, 0) = 0 THEN NULL
      WHEN ${reported} - COALESCE(${d}.amt, 0) > ${TOLERANCE}
        THEN ${reported} - COALESCE(${d}.amt, 0)
      ELSE NULL
    END`;
  }

  /** Read back the counts the log line and the caller report. */
  private async summarise(): Promise<ReconciliationSummary> {
    const rows = await this.db!.$queryRawUnsafe<
      Array<{
        reconciled: bigint;
        over_c: bigint;
        over_e: bigint;
        with_unitemized: bigint;
        unitemized_total: string | null;
        unknown_schedule: bigint;
      }>
    >(`
      SELECT COUNT(*)::bigint AS reconciled,
             COUNT(*) FILTER (
               WHERE "contribution_status"
                     = '${RECONCILIATION_STATUS.OVER_ITEMIZED}')::bigint
               AS over_c,
             COUNT(*) FILTER (
               WHERE "expenditure_status"
                     = '${RECONCILIATION_STATUS.OVER_ITEMIZED}')::bigint
               AS over_e,
             COUNT(*) FILTER (
               WHERE "unitemized_contributions" IS NOT NULL)::bigint
               AS with_unitemized,
             COALESCE(SUM("unitemized_contributions"), 0)::text
               AS unitemized_total,
             COUNT(*) FILTER (
               WHERE "contribution_status"
                     = '${RECONCILIATION_STATUS.UNKNOWN_SCHEDULE}')::bigint
               AS unknown_schedule
        FROM "filing_reconciliations"
    `);

    const r = rows[0];
    if (!r) return { ...EMPTY };

    return {
      reconciled: Number(r.reconciled),
      overItemizedContributions: Number(r.over_c),
      overItemizedExpenditures: Number(r.over_e),
      withUnitemized: Number(r.with_unitemized),
      unitemizedTotal: Number(r.unitemized_total ?? 0),
      unknownSchedule: Number(r.unknown_schedule),
    };
  }
}
