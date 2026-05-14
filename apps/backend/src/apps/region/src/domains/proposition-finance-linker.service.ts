import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommitteeMeasurePositionType,
  DbService,
} from '@opuspopuli/relationaldb-provider';
import { readPositiveInt } from './config-helpers';

/**
 * Connects campaign-finance records to propositions.
 *
 * Two paths populate `committee_measure_positions` and the new `proposition_id`
 * FKs on expenditures / independent_expenditures:
 *
 * 1) **CVR2 (FPPC Form 410, authoritative)**: every `cvr2_filings` row gives
 *    `(filingId, ballotName, supportOrOppose)`. We resolve `filingId →
 *    committeeId` by reading `Contribution`/`Expenditure.externalId` (which
 *    encodes FILING_ID per the bulk-download convention), and resolve
 *    `ballotName → propositionId` via the title lookup. Each row that
 *    resolves writes a `CommitteeMeasurePosition` with
 *    `isPrimaryFormation = true` and `sourceFiling = filingId`.
 *
 * 2) **Inferred (from existing receipts/expenditures)**: every
 *    `Expenditure` / `IndependentExpenditure` row that already carries a
 *    `propositionTitle` (sourced from `BAL_NAME` on RCPT_CD/EXPN_CD/S496_CD)
 *    gets its `propositionId` FK populated, and the owning committee gets a
 *    `CommitteeMeasurePosition` row with `isPrimaryFormation = false`.
 *
 * Idempotent: every step uses upserts on stable unique keys. Re-running over
 * the same data is a no-op.
 *
 * Tunables:
 * - `FINANCE_LINKER_TITLE_MATCH_MIN_TOKENS` (default 2) — minimum number of
 *   normalized tokens that must overlap for a fuzzy title match to count.
 * - `FINANCE_LINKER_ELECTION_WINDOW_YEARS` (default 2) — only consider
 *   propositions whose `electionDate` falls within this many years of "now"
 *   when building the title lookup. Keeps the fuzzy-match space small and
 *   avoids cross-cycle false positives.
 */
@Injectable()
export class PropositionFinanceLinkerService {
  private readonly logger = new Logger(PropositionFinanceLinkerService.name);
  private readonly minMatchTokens: number;
  private readonly electionWindowYears: number;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly db?: DbService,
  ) {
    this.minMatchTokens = readPositiveInt(
      this.config,
      'FINANCE_LINKER_TITLE_MATCH_MIN_TOKENS',
      2,
    );
    this.electionWindowYears = readPositiveInt(
      this.config,
      'FINANCE_LINKER_ELECTION_WINDOW_YEARS',
      2,
    );
  }

  /**
   * Run the full link pass. Safe to call after every campaign-finance sync
   * batch — idempotent thanks to the unique constraint on
   * `(committeeId, propositionId, position)`.
   *
   * Returns counts so callers can log progress; never throws on a single
   * record's resolution failure (those are warned and skipped).
   */
  async linkAll(): Promise<{
    cvr2Resolved: number;
    cvr2Skipped: number;
    expenditureLinked: number;
    independentExpenditureLinked: number;
    inferredPositions: number;
  }> {
    if (!this.db) {
      return {
        cvr2Resolved: 0,
        cvr2Skipped: 0,
        expenditureLinked: 0,
        independentExpenditureLinked: 0,
        inferredPositions: 0,
      };
    }

    const titleLookup = await this.buildTitleLookup();
    if (titleLookup.size === 0) {
      this.logger.debug(
        'No propositions in election window — finance linker is a no-op',
      );
      return {
        cvr2Resolved: 0,
        cvr2Skipped: 0,
        expenditureLinked: 0,
        independentExpenditureLinked: 0,
        inferredPositions: 0,
      };
    }

    const filingToCommittee = await this.buildFilingToCommitteeIndex();

    const cvr2Result = await this.linkFromCvr2Filings(
      titleLookup,
      filingToCommittee,
    );
    const expenditureLinked = await this.linkExpenditures(titleLookup);
    const independentExpenditureLinked =
      await this.linkIndependentExpenditures(titleLookup);
    const inferredPositions = await this.upsertInferredPositions();

    this.logger.log(
      `Finance linker pass complete: ` +
        `cvr2=${cvr2Result.resolved}/${cvr2Result.resolved + cvr2Result.skipped}, ` +
        `expenditures linked=${expenditureLinked}, IEs linked=${independentExpenditureLinked}, ` +
        `inferred positions=${inferredPositions}`,
    );

    return {
      cvr2Resolved: cvr2Result.resolved,
      cvr2Skipped: cvr2Result.skipped,
      expenditureLinked,
      independentExpenditureLinked,
      inferredPositions,
    };
  }

  /**
   * Build a lookup from normalized title tokens to a `Proposition.id`.
   * Constrained to the active election window so a 2024 measure with a
   * similar title doesn't capture 2026 contributions. Returns empty when
   * no propositions are in window.
   */
  private async buildTitleLookup(): Promise<Map<string, string>> {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - this.electionWindowYears);

    const props = await this.db!.proposition.findMany({
      where: {
        deletedAt: null,
        OR: [{ electionDate: null }, { electionDate: { gte: cutoff } }],
      },
      select: { id: true, externalId: true, title: true },
    });

    const lookup = new Map<string, string>();
    for (const prop of props) {
      // Index two ways so callers can match either an exact externalId hit
      // ("ACA 13") or a fuzzy title hit ("Voting thresholds").
      lookup.set(this.normalize(prop.externalId), prop.id);
      lookup.set(this.normalize(prop.title), prop.id);
    }
    return lookup;
  }

  /**
   * Build `filingId → committeeId` from existing Contribution / Expenditure
   * rows. The bulk-download handler stores externalIds shaped like
   * `<FILING_ID>:<row index>` (or similar); we extract the FILING_ID prefix
   * and pair it with the row's `committeeId`.
   */
  private async buildFilingToCommitteeIndex(): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    const addRows = async (
      rows: Array<{ externalId: string; committeeId: string }>,
    ) => {
      for (const r of rows) {
        const filingId = this.extractFilingId(r.externalId);
        if (filingId && !map.has(filingId)) {
          map.set(filingId, r.committeeId);
        }
      }
    };

    await addRows(
      await this.db!.contribution.findMany({
        select: { externalId: true, committeeId: true },
      }),
    );
    await addRows(
      await this.db!.expenditure.findMany({
        select: { externalId: true, committeeId: true },
      }),
    );

    return map;
  }

  /**
   * Walk every `Cvr2Filing` row and write a `CommitteeMeasurePosition` for
   * each one whose filingId resolves to a known committee AND whose
   * ballotName / ballotNumber resolves to a known proposition. Sets
   * `isPrimaryFormation = true` because CVR2 is the authoritative Form 410
   * declaration.
   */
  private async linkFromCvr2Filings(
    titleLookup: Map<string, string>,
    filingToCommittee: Map<string, string>,
  ): Promise<{ resolved: number; skipped: number }> {
    const filings = await this.db!.cvr2Filing.findMany({
      select: {
        filingId: true,
        ballotName: true,
        ballotNumber: true,
        supportOrOppose: true,
      },
    });

    let resolved = 0;
    let skipped = 0;

    for (const f of filings) {
      const committeeId = filingToCommittee.get(f.filingId);
      const propositionId =
        this.resolveProposition(f.ballotNumber, titleLookup) ??
        this.resolveProposition(f.ballotName, titleLookup);
      const position = this.mapPosition(f.supportOrOppose);

      if (!committeeId || !propositionId || !position) {
        skipped++;
        continue;
      }

      await this.upsertPosition({
        committeeId,
        propositionId,
        position,
        isPrimaryFormation: true,
        sourceFiling: f.filingId,
      });
      resolved++;
    }

    return { resolved, skipped };
  }

  /**
   * Resolve `Expenditure.propositionTitle` strings to a `Proposition.id` and
   * write the FK back. Skips rows that already have `propositionId` set.
   */
  private async linkExpenditures(
    titleLookup: Map<string, string>,
  ): Promise<number> {
    const candidates = await this.db!.expenditure.findMany({
      where: {
        propositionId: null,
        propositionTitle: { not: null },
      },
      select: { id: true, propositionTitle: true },
    });

    let linked = 0;
    for (const e of candidates) {
      const propositionId = this.resolveProposition(
        e.propositionTitle,
        titleLookup,
      );
      if (!propositionId) continue;
      await this.db!.expenditure.update({
        where: { id: e.id },
        data: { propositionId },
      });
      linked++;
    }
    return linked;
  }

  /** Same idea as `linkExpenditures` but for IndependentExpenditure rows. */
  private async linkIndependentExpenditures(
    titleLookup: Map<string, string>,
  ): Promise<number> {
    const candidates = await this.db!.independentExpenditure.findMany({
      where: {
        propositionId: null,
        propositionTitle: { not: null },
      },
      select: { id: true, propositionTitle: true },
    });

    let linked = 0;
    for (const ie of candidates) {
      const propositionId = this.resolveProposition(
        ie.propositionTitle,
        titleLookup,
      );
      if (!propositionId) continue;
      await this.db!.independentExpenditure.update({
        where: { id: ie.id },
        data: { propositionId },
      });
      linked++;
    }
    return linked;
  }

  /**
   * For every (committeeId, propositionId) pair that surfaces in linked
   * Expenditure / IndependentExpenditure rows, upsert a
   * `CommitteeMeasurePosition` with `isPrimaryFormation = false` if a row
   * doesn't already exist. The unique constraint guarantees idempotency.
   * The position is taken from each row's `supportOrOppose`; rows with no
   * usable position are skipped.
   */
  private async upsertInferredPositions(): Promise<number> {
    const expRows = await this.db!.expenditure.findMany({
      where: { propositionId: { not: null } },
      select: {
        committeeId: true,
        propositionId: true,
        supportOrOppose: true,
      },
      distinct: ['committeeId', 'propositionId', 'supportOrOppose'],
    });
    const ieRows = await this.db!.independentExpenditure.findMany({
      where: { propositionId: { not: null } },
      select: {
        committeeId: true,
        propositionId: true,
        supportOrOppose: true,
      },
      distinct: ['committeeId', 'propositionId', 'supportOrOppose'],
    });

    let written = 0;
    const seen = new Set<string>();
    for (const r of [...expRows, ...ieRows]) {
      if (!r.propositionId) continue;
      const position = this.mapPosition(r.supportOrOppose ?? null);
      if (!position) continue;
      const key = `${r.committeeId}:${r.propositionId}:${position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const created = await this.upsertPosition({
        committeeId: r.committeeId,
        propositionId: r.propositionId,
        position,
        isPrimaryFormation: false,
        sourceFiling: null,
      });
      if (created) written++;
    }
    return written;
  }

  /**
   * Upsert a single `CommitteeMeasurePosition`. Returns `true` when a new
   * row was created. The unique key is `(committeeId, propositionId,
   * position)`. We only OVERWRITE `isPrimaryFormation` when the new value
   * is `true` — a CVR2-sourced row should never be downgraded to inferred
   * by a subsequent expenditure pass.
   */
  private async upsertPosition(input: {
    committeeId: string;
    propositionId: string;
    position: 'support' | 'oppose';
    isPrimaryFormation: boolean;
    sourceFiling: string | null;
  }): Promise<boolean> {
    const positionEnum =
      input.position === 'support'
        ? CommitteeMeasurePositionType.support
        : CommitteeMeasurePositionType.oppose;

    const result = await this.db!.committeeMeasurePosition.upsert({
      where: {
        committeeId_propositionId_position: {
          committeeId: input.committeeId,
          propositionId: input.propositionId,
          position: positionEnum,
        },
      },
      update: input.isPrimaryFormation
        ? {
            isPrimaryFormation: true,
            sourceFiling: input.sourceFiling ?? undefined,
          }
        : {},
      create: {
        committeeId: input.committeeId,
        propositionId: input.propositionId,
        position: positionEnum,
        isPrimaryFormation: input.isPrimaryFormation,
        sourceFiling: input.sourceFiling,
      },
      select: { createdAt: true, updatedAt: true },
    });
    // Newly-created rows have createdAt === updatedAt; updates differ.
    return result.createdAt.getTime() === result.updatedAt.getTime();
  }

  /**
   * Map CalAccess SUP_OPP_CD ('S' / 'O') and the loose 'support' / 'oppose'
   * strings used in our schema to the enum values. Returns null for
   * anything we can't recognize — those rows are skipped rather than
   * guessed at.
   */
  private mapPosition(
    raw: string | null | undefined,
  ): 'support' | 'oppose' | null {
    if (!raw) return null;
    const v = raw.trim().toLowerCase();
    if (v === 's' || v === 'support') return 'support';
    if (v === 'o' || v === 'oppose') return 'oppose';
    return null;
  }

  /**
   * Resolve a free-text title (BAL_NAME, BAL_NUM, or propositionTitle) to a
   * Proposition.id. Tries an exact normalized match first, then a token
   * overlap heuristic that requires at least `minMatchTokens` normalized
   * tokens to be a prefix of any indexed title. Returns null on no match.
   */
  private resolveProposition(
    title: string | null | undefined,
    titleLookup: Map<string, string>,
  ): string | null {
    if (!title) return null;
    const normalized = this.normalize(title);
    if (!normalized) return null;

    const exact = titleLookup.get(normalized);
    if (exact) return exact;

    // Fuzzy: token-prefix match against any indexed key.
    const tokens = normalized.split(' ').filter((t) => t.length > 1);
    if (tokens.length < this.minMatchTokens) return null;

    const probe = tokens.slice(0, this.minMatchTokens).join(' ');
    for (const [key, propositionId] of titleLookup.entries()) {
      if (key.startsWith(probe)) return propositionId;
    }
    return null;
  }

  /**
   * Normalize a string for matching: lowercase, strip punctuation, collapse
   * whitespace. Keeps alphanumerics + spaces only.
   */
  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
  }

  /**
   * Pull the FILING_ID prefix out of an externalId. The bulk-download
   * handler concatenates FILING_ID + a row discriminator with either ':'
   * or '-' as the separator; we conservatively split on either. If no
   * separator exists, the entire externalId is treated as the filing id.
   */
  private extractFilingId(externalId: string): string | null {
    if (!externalId) return null;
    const idx = externalId.search(/[:-]/);
    return idx >= 0 ? externalId.slice(0, idx) : externalId;
  }
}
