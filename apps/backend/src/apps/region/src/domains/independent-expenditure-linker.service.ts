import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { batchTransaction } from '@opuspopuli/common';

export interface IndependentExpenditureLinkResult {
  /** IEs stamped with a resolved committee + target this run. */
  linked: number;
  /** Pending IE whose FILING_ID has no Form 496 cover page in cvr_filings. */
  skippedNoCoverPage: number;
  /** Cover page found, but its FILER_ID matches no committee row. */
  skippedNoCommittee: number;
  /** Total unresolved (committee-less) IEs considered this run. */
  considered: number;
}

/** A Form 496 cover-page row, reduced to the join + target fields the linker uses. */
type CoverRow = {
  filingId: string;
  filerId: string;
  candidateName: string | null;
  propositionTitle: string | null;
  supportOrOppose: string | null;
};

/**
 * Attribute independent expenditures to their committee + target (#955).
 *
 * CAL-ACCESS `S496_CD` (Form 496 late-IE line items) carry only a `FILING_ID`
 * — no committee, candidate, measure, or support/oppose. Those live on the
 * Form 496 cover page (`CVR_CAMPAIGN_DISCLOSURE_CD`, `FORM_TYPE=F496`), which
 * the sync persists to `cvr_filings`. Each IE is ingested with a null
 * `committeeId` + its `filingId`; this linker joins
 * `IndependentExpenditure.filingId → CvrFiling.filingId → CvrFiling.filerId →
 * Committee.externalId` and stamps the committee, committee name, and target
 * (candidate/measure + support/oppose) onto the IE.
 *
 * Post-sync and idempotent: only rows with `committeeId == null` are
 * considered, so re-running only touches still-unresolved IEs (never
 * re-writes or unlinks a resolved one). Runs before the proposition linker so
 * the `propositionTitle` it stamps gets resolved to a `propositionId`.
 */
@Injectable()
export class IndependentExpenditureLinkerService {
  private readonly logger = new Logger(
    IndependentExpenditureLinkerService.name,
  );

  constructor(@Optional() private readonly db?: DbService) {}

  /** Index cover pages by FILING_ID (one per filing; first wins on duplicates). */
  private indexCoversByFiling(covers: CoverRow[]): Map<string, CoverRow> {
    const byFiling = new Map<string, CoverRow>();
    for (const c of covers) {
      if (!byFiling.has(c.filingId)) byFiling.set(c.filingId, c);
    }
    return byFiling;
  }

  async linkAll(): Promise<IndependentExpenditureLinkResult> {
    const empty: IndependentExpenditureLinkResult = {
      linked: 0,
      skippedNoCoverPage: 0,
      skippedNoCommittee: 0,
      considered: 0,
    };
    if (!this.db) return empty;

    // IEs awaiting committee attribution — the S496 line items. FEC IEs and
    // already-linked rows carry a committeeId and are skipped by this filter.
    const pending = await this.db.independentExpenditure.findMany({
      where: { committeeId: null, filingId: { not: null } },
      select: { id: true, filingId: true },
    });
    if (pending.length === 0) return empty;

    // Cover-page map: FILING_ID -> filer + target. One cover page per filing;
    // guard against duplicates (first wins — the upsert dedups by filingId too).
    const covers = await this.db.cvrFiling.findMany({
      select: {
        filingId: true,
        filerId: true,
        candidateName: true,
        propositionTitle: true,
        supportOrOppose: true,
      },
    });
    const coverByFiling = this.indexCoversByFiling(covers);
    if (coverByFiling.size === 0) {
      return {
        ...empty,
        considered: pending.length,
        skippedNoCoverPage: pending.length,
      };
    }

    // Resolve each cover page's FILER_ID to a committee row. FILER_ID shares the
    // committees.external_id id space (populated by the Committees roster source).
    const filerIds = [...new Set(covers.map((c) => c.filerId))];
    const committees = await this.db.committee.findMany({
      where: { externalId: { in: filerIds }, deletedAt: null },
      select: { externalId: true, id: true, name: true },
    });
    const committeeByExternal = new Map(
      committees.map((c) => [c.externalId, c]),
    );

    let linked = 0;
    let skippedNoCoverPage = 0;
    let skippedNoCommittee = 0;
    const updates = [];

    for (const ie of pending) {
      const cover = ie.filingId ? coverByFiling.get(ie.filingId) : undefined;
      if (!cover) {
        skippedNoCoverPage++;
        continue;
      }
      const committee = committeeByExternal.get(cover.filerId);
      if (!committee) {
        skippedNoCommittee++;
        continue;
      }
      updates.push(
        this.db.independentExpenditure.update({
          where: { id: ie.id },
          data: {
            committeeId: committee.id,
            committeeName: committee.name,
            candidateName: cover.candidateName ?? undefined,
            propositionTitle: cover.propositionTitle ?? undefined,
            // Only overwrite the defaulted 'support' when the cover page states one.
            ...(cover.supportOrOppose
              ? { supportOrOppose: cover.supportOrOppose }
              : {}),
          },
        }),
      );
      linked++;
    }

    if (updates.length > 0) {
      await batchTransaction(this.db, updates);
    }

    this.logger.log(
      `Independent-expenditure linker: linked=${linked} ` +
        `noCoverPage=${skippedNoCoverPage} noCommittee=${skippedNoCommittee} ` +
        `(of ${pending.length} unresolved IEs)`,
    );

    return {
      linked,
      skippedNoCoverPage,
      skippedNoCommittee,
      considered: pending.length,
    };
  }
}
