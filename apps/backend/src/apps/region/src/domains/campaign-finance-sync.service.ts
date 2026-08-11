import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  batchTransaction,
  sortCampaignFinanceItems,
  type CampaignFinanceResult,
} from '@opuspopuli/common';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { CandidateCommitteeLinkerService } from './candidate-committee-linker.service';
import { IndependentExpenditureLinkerService } from './independent-expenditure-linker.service';
import { CoverPageLinkerService } from './cover-page-linker.service';
import { AmendmentSupersessionService } from './amendment-supersession.service';
import {
  campaignFinanceSyncTracker,
  type SyncPhaseTracker,
  type CampaignFinanceSyncPhase,
} from './sync-phase-logger';

/**
 * Minimal provider contract for campaign-finance ingestion. Optional
 * `fetchCampaignFinance` mirrors the existing pattern — regions that
 * don't expose a finance source short-circuit the sync entirely.
 */
export interface CampaignFinanceProvider {
  fetchCampaignFinance?(
    onBatch?: (items: Record<string, unknown>[]) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<CampaignFinanceResult>;
}

type PrismaModelDelegate = {
  findMany(
    args: unknown,
  ): Promise<{ externalId: string; amendId?: number | null }[]>;
  upsert(args: unknown): Prisma.PrismaPromise<unknown>;
};

type UpsertConfig = {
  records: readonly unknown[];
  model: PrismaModelDelegate;
  fields: string[];
  /**
   * Rows on this table are amendable: the same `externalId` can arrive more
   * than once, once per version of the filing, and only the newest version may
   * win. Enables the `amendId` guard in {@link upsertRecordsByFields} (#992).
   */
  amendable?: boolean;
};

type CommitteeRecord = {
  externalId: string;
  id: string;
};

/**
 * Owns campaign-finance ingestion (extracted from RegionSyncService as
 * #828 Step 4). Phases: discover → extract_and_upsert (batched via
 * CAL-ACCESS streaming callback) + post-link via PropositionFinanceLinker.
 *
 * Streaming model: CAL-ACCESS bulk downloads are too large to log every
 * record individually, so observability lives at the batch level via
 * `tracker.note(batch N: ...)` rather than per-item. The phase boundaries
 * still fire so operators see "Phase 1/2 complete → Phase 2/2 starting"
 * regardless of streaming layout.
 */
@Injectable()
export class CampaignFinanceSyncService {
  private readonly logger = new Logger(CampaignFinanceSyncService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    @Optional()
    private readonly propositionFinanceLinker?: PropositionFinanceLinkerService,
    @Optional()
    private readonly candidateCommitteeLinker?: CandidateCommitteeLinkerService,
    @Optional()
    private readonly independentExpenditureLinker?: IndependentExpenditureLinkerService,
    @Optional()
    private readonly coverPageLinker?: CoverPageLinkerService,
    @Optional()
    private readonly amendmentSupersession?: AmendmentSupersessionService,
  ) {}

  async sync(
    provider: CampaignFinanceProvider,
    pipelineJobId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!provider.fetchCampaignFinance) {
      return { processed: 0, created: 0, updated: 0 };
    }

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let batchCount = 0;

    // Campaign finance uses a streaming callback (CAL-ACCESS bulk
    // download → onBatch per chunk) rather than per-item iteration,
    // so observability lives at the batch level. Phase trackers are
    // initialized with total=0 and we use `note()` per batch instead
    // of `item()` per record — the dataset is too large to log every
    // contribution/expenditure individually.
    //
    // Phase 1 (discover) and Phase 2 (extract_and_upsert) are
    // intentionally constructed and completed sequentially. The
    // extract tracker is lazily initialized on the first onBatch
    // callback so the phase-start log line for Phase 2 lands AFTER
    // Phase 1's complete line — operator-readable phase ordering.
    const discoverTracker = campaignFinanceSyncTracker(
      this.logger,
      'discover',
      0,
    );
    discoverTracker.note('preparing CAL-ACCESS bulk download stream');

    // Use a single-property ref so TypeScript can't narrow the inner
    // type to `never` after the if-check below — closures that mutate
    // a captured `let` variable defeat TS's flow analysis. The ref
    // pattern sidesteps that without sprinkling `!` assertions.
    const extractRef: {
      tracker: SyncPhaseTracker<CampaignFinanceSyncPhase> | null;
    } = { tracker: null };
    const ensureExtractTracker =
      (): SyncPhaseTracker<CampaignFinanceSyncPhase> => {
        if (!extractRef.tracker) {
          // First batch arrived → discover phase is functionally done.
          discoverTracker.complete();
          extractRef.tracker = campaignFinanceSyncTracker(
            this.logger,
            'extract_and_upsert',
            0,
          );
        }
        return extractRef.tracker;
      };

    const onBatch = async (items: Record<string, unknown>[]) => {
      const tracker = ensureExtractTracker();
      const batchData = this.sortItems(items);
      await this.enrichCommittees(batchData);
      await this.ensureCommitteeStubs(batchData);
      const result = await this.upsertBatch(batchData);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
      batchCount++;
      tracker.note(
        `batch ${batchCount}: ${result.processed} items (${result.created} created, ${result.updated} updated)`,
      );
    };

    const data = await provider.fetchCampaignFinance(onBatch, pipelineJobId);

    if (
      data.committees.length > 0 ||
      data.contributions.length > 0 ||
      data.expenditures.length > 0 ||
      data.independentExpenditures.length > 0 ||
      data.committeeMeasureFilings.length > 0 ||
      data.cvrFilings.length > 0 ||
      // Every table the flush can write must be listed here. Omitting one
      // means its rows are dropped whenever no *other* table happens to carry
      // data in the same fetch — silently, and only for that shape of config.
      (data.filingSummaries?.length ?? 0) > 0
    ) {
      const tracker = ensureExtractTracker();
      await this.enrichCommittees(data);
      await this.ensureCommitteeStubs(data);
      const result = await this.upsertBatch(data);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
      tracker.note(
        `final flush: ${result.processed} items (${result.created} created, ${result.updated} updated)`,
      );
    }

    // Either the lazy ensureExtractTracker() ran (and started phase 2
    // after completing phase 1), or no batches ever arrived. In the
    // latter case close phase 1 now and emit an empty phase 2 marker
    // so the operator sees both phase boundaries regardless of data.
    if (extractRef.tracker) {
      extractRef.tracker.complete();
    } else {
      discoverTracker.complete();
      const emptyExtractTracker = campaignFinanceSyncTracker(
        this.logger,
        'extract_and_upsert',
        0,
        { note: 'no data from provider' },
      );
      emptyExtractTracker.complete();
    }

    await this.runPostSyncLinkers();

    return {
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
    };
  }

  /**
   * Run the attribution linkers, in order. Each is optional (they are
   * `@Optional()` injections) and each is isolated: one failing must not cost
   * the sync its upserted data or stop the others running.
   *
   * **The order is load-bearing.** Both the IE linker (#955) and the
   * cover-page linker (#980) stamp `committeeId` onto rows the proposition
   * linker then reads to derive measure positions — run it first and it sees
   * nothing, silently writing no positions. The candidate-committee linker
   * (#941) runs last so it sees committees carrying their enriched
   * candidateName/office. Covered by campaign-finance-sync.service.spec.ts.
   */
  private async runPostSyncLinkers(): Promise<void> {
    // Uniform thunks rather than a shared interface, so each step can name its
    // method for what it does (supersede vs link) instead of pretending to be
    // a linker.
    const steps: Array<[string, (() => Promise<unknown>) | undefined]> = [
      // FIRST: a superseded amendment's rows are stale duplicates. Attributing
      // them, or deriving measure positions from them, is wasted work — and
      // every later step's counts would describe rows about to vanish (#992).
      [
        'Amendment-supersession',
        this.amendmentSupersession &&
          (() => this.amendmentSupersession!.supersedeAll()),
      ],
      [
        'Independent-expenditure',
        this.independentExpenditureLinker &&
          (() => this.independentExpenditureLinker!.linkAll()),
      ],
      [
        'Cover-page',
        this.coverPageLinker && (() => this.coverPageLinker!.linkAll()),
      ],
      [
        'Proposition finance',
        this.propositionFinanceLinker &&
          (() => this.propositionFinanceLinker!.linkAll()),
      ],
      [
        'Candidate-committee',
        this.candidateCommitteeLinker &&
          (() => this.candidateCommitteeLinker!.linkAll()),
      ],
    ];

    for (const [name, run] of steps) {
      if (!run) continue;
      try {
        await run();
      } catch (error) {
        this.logger.warn(`${name} step failed: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Make sure every Committee referenced by an incoming finance record
   * has a row in the `committees` table before the per-record upserts
   * fire — otherwise the FK constraint trips. Stubs are upserted with
   * minimal data; real Committee enrichment lands as the finance
   * dataset is processed by the linker.
   *
   * Also rewrites the in-memory `committeeId` on each record from the
   * source-system externalId to the DB UUID so per-record upserts can
   * use it directly as the FK.
   */
  private async ensureCommitteeStubs(
    data: CampaignFinanceResult,
  ): Promise<void> {
    const referencedIds = new Set<string>();
    const sourceSystemByExternalId = new Map<string, 'cal_access' | 'fec'>();
    const noteReference = (
      committeeId: string | undefined | null,
      sourceSystem: 'cal_access' | 'fec',
    ) => {
      if (!committeeId) return;
      referencedIds.add(committeeId);
      if (!sourceSystemByExternalId.has(committeeId)) {
        sourceSystemByExternalId.set(committeeId, sourceSystem);
      }
    };
    for (const c of data.contributions)
      noteReference(c.committeeId, c.sourceSystem);
    for (const e of data.expenditures)
      noteReference(e.committeeId, e.sourceSystem);
    for (const ie of data.independentExpenditures) {
      noteReference(ie.committeeId, ie.sourceSystem);
    }

    if (referencedIds.size === 0) return;

    const existing = await this.db.committee.findMany({
      where: { externalId: { in: [...referencedIds] } },
      select: { externalId: true, id: true },
    });
    const existingMap = new Map(
      existing.map((c: CommitteeRecord) => [c.externalId, c.id]),
    );

    const missingIds = [...referencedIds].filter((id) => !existingMap.has(id));

    if (missingIds.length > 0) {
      this.logger.log(
        `Creating ${missingIds.length} stub committee records for FK references`,
      );
      await batchTransaction(
        this.db,
        missingIds.map((externalId) =>
          this.db.committee.create({
            data: {
              externalId,
              name: externalId,
              type: 'other',
              status: 'active',
              sourceSystem: sourceSystemByExternalId.get(externalId) ?? 'fec',
            },
          }),
        ),
      );
    }

    const allCommittees = await this.db.committee.findMany({
      where: { externalId: { in: [...referencedIds] } },
      select: { externalId: true, id: true },
    });
    const idMap = new Map(
      allCommittees.map((c: CommitteeRecord) => [c.externalId, c.id]),
    );

    // RCPT/EXPN line items arrive with no committeeId once the region config
    // stops mapping CMTE_ID — the filer is resolved later from the cover page
    // (#980), exactly as S496 IEs have been since #955. Only rewrite the
    // externalId -> UUID for rows that actually reference a committee.
    const resolveCommittee = (row: { committeeId?: string }) => {
      if (row.committeeId) {
        row.committeeId = idMap.get(row.committeeId) ?? row.committeeId;
      }
    };

    data.contributions.forEach(resolveCommittee);
    data.expenditures.forEach(resolveCommittee);
    data.independentExpenditures.forEach(resolveCommittee);
  }

  /**
   * Enrich committee rows from roster records (FEC cm.txt / CAL-ACCESS CVR
   * cover pages). Upserts by externalId so a stub created from a transaction
   * (name = externalId, type = OTHER) is updated IN PLACE with its real
   * identity — same DB id, so every Contribution/Expenditure/IE FK is
   * preserved (#939). Never deletes or recreates a committee, and never
   * blanks out an existing candidate/party field from a filing that lacked
   * it (cover pages repeat per filing and some carry less data).
   */
  private async enrichCommittees(data: CampaignFinanceResult): Promise<void> {
    if (data.committees.length === 0) return;
    // Cover pages repeat per filing — dedup within the batch (last wins).
    const byExternalId = new Map<
      string,
      CampaignFinanceResult['committees'][number]
    >();
    for (const c of data.committees) {
      if (c.externalId) byExternalId.set(c.externalId, c);
    }
    if (byExternalId.size === 0) return;

    await batchTransaction(
      this.db,
      [...byExternalId.values()].map((c) =>
        this.db.committee.upsert({
          where: { externalId: c.externalId },
          create: {
            externalId: c.externalId,
            name: c.name,
            type: c.type,
            candidateName: c.candidateName ?? null,
            candidateOffice: c.candidateOffice ?? null,
            // party is a VarChar(50) — cap so a malformed oversized value
            // skips this field rather than failing the whole 500-row chunk.
            party: c.party ? c.party.slice(0, 50) : null,
            status: c.status ?? 'active',
            sourceSystem: c.sourceSystem,
            sourceUrl: c.sourceUrl ?? null,
          },
          update: {
            name: c.name,
            sourceSystem: c.sourceSystem,
            // Only overwrite `type` with a recognized value — a later filing
            // whose CMTTE_TYPE was blank/unknown maps to 'other', which must
            // not downgrade a committee already enriched to candidate/pac/etc.
            ...(c.type && c.type !== 'other' ? { type: c.type } : {}),
            ...(c.candidateName ? { candidateName: c.candidateName } : {}),
            ...(c.candidateOffice
              ? { candidateOffice: c.candidateOffice }
              : {}),
            ...(c.party ? { party: c.party.slice(0, 50) } : {}),
            ...(c.sourceUrl ? { sourceUrl: c.sourceUrl } : {}),
          },
        }),
      ),
    );
    this.logger.log(
      `Enriched ${byExternalId.size} committee(s) from roster records`,
    );
  }

  /**
   * Route a heterogeneous batch of records (everything CAL-ACCESS streams out)
   * into the typed shape `CampaignFinanceResult` expects.
   *
   * The rules live in `@opuspopuli/common` because the region plugin sorts the
   * same stream the same way, and two copies had to be edited in lockstep.
   */
  private sortItems(items: Record<string, unknown>[]): CampaignFinanceResult {
    return sortCampaignFinanceItems(items);
  }

  /**
   * Upsert one streamed batch across four tables (contributions,
   * expenditures, independent expenditures, committee measure filings)
   * inside a single transaction per table.
   */
  private async upsertBatch(
    data: CampaignFinanceResult,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const upsertConfigs: UpsertConfig[] = [
      {
        records: data.contributions,
        model: this.db.contribution,
        amendable: true,
        fields: [
          'committeeId',
          'filingId',
          'amendId',
          'donorName',
          'donorType',
          'donorEmployer',
          'donorOccupation',
          'donorCity',
          'donorState',
          'donorZip',
          'amount',
          'date',
          'electionType',
          'contributionType',
          'sourceSystem',
        ],
      },
      {
        records: data.expenditures,
        model: this.db.expenditure,
        amendable: true,
        fields: [
          'committeeId',
          'filingId',
          'amendId',
          'payeeName',
          'amount',
          'date',
          'purposeDescription',
          'expenditureCode',
          'candidateName',
          'propositionTitle',
          'supportOrOppose',
          'sourceSystem',
        ],
      },
      {
        records: data.independentExpenditures,
        model: this.db.independentExpenditure,
        fields: [
          'committeeId',
          'filingId',
          'committeeName',
          'candidateName',
          'propositionTitle',
          'supportOrOppose',
          'amount',
          'date',
          'electionDate',
          'description',
          'sourceSystem',
        ],
      },
      {
        records: data.committeeMeasureFilings,
        model: this.db.cvr2Filing,
        fields: [
          'filingId',
          'ballotName',
          'ballotNumber',
          'ballotJurisdiction',
          'supportOrOppose',
          'sourceSystem',
        ],
      },
      {
        records: data.cvrFilings,
        model: this.db.cvrFiling,
        fields: [
          'filingId',
          'filerId',
          'candidateName',
          'candidateOffice',
          'propositionTitle',
          'supportOrOppose',
          'sourceSystem',
        ],
      },
      {
        records: data.filingSummaries,
        model: this.db.filingSummary,
        // Deliberately NOT `amendable`: AMEND_ID is part of this table's
        // identity, so each amendment's summary is its own row and nothing
        // supersedes anything. Reconciliation reads the latest one (#992).
        fields: [
          'filingId',
          'amendId',
          'formType',
          'lineItem',
          'amountA',
          'amountB',
          'amountC',
          'sourceSystem',
        ],
      },
    ];

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const config of upsertConfigs) {
      // Optional chain, not `.length`: a provider built against an older
      // CampaignFinanceResult omits newer arrays entirely, and dropping its
      // rows beats throwing mid-sync.
      if (!config.records?.length) continue;
      const result = await this.upsertRecordsByFields(config);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
    }

    return {
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
    };
  }

  /**
   * Low-level field-projection upsert used only by `upsertBatch`. Pulls
   * the configured `fields` off each record and upserts by `externalId`
   * inside a single batch transaction.
   *
   * On amendable tables the write is ordered by `amendId` rather than by
   * arrival, so the newest version of a restated row always wins — see
   * {@link keepNewestAmendment}.
   */
  private async upsertRecordsByFields(
    config: UpsertConfig,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const { model, fields } = config;
    const incoming = config.records as Record<string, unknown>[];
    const externalIds = incoming.map((r) => r.externalId as string);

    const existing = await model.findMany({
      where: { externalId: { in: externalIds } },
      select: config.amendable
        ? { externalId: true, amendId: true }
        : { externalId: true },
    });
    const existingSet = new Set(
      existing.map((r: { externalId: string }) => r.externalId),
    );

    const rows = config.amendable
      ? this.keepNewestAmendment(incoming, existing)
      : incoming;

    const pick = (r: Record<string, unknown>) =>
      Object.fromEntries(fields.map((f: string) => [f, r[f]]));

    if (rows.length === 0) return { processed: 0, created: 0, updated: 0 };

    await batchTransaction(
      this.db,
      rows.map((r) =>
        model.upsert({
          where: { externalId: r.externalId as string },
          update: pick(r),
          create: { externalId: r.externalId, ...pick(r) },
        }),
      ),
    );

    const created = rows.filter(
      (r) => !existingSet.has(r.externalId as string),
    ).length;
    return {
      processed: rows.length,
      created,
      updated: rows.length - created,
    };
  }

  /**
   * Reduce restated rows to the newest version of each `externalId`, whether
   * the older version arrives in the same batch or is already stored.
   *
   * CAL-ACCESS restates a filing's whole schedule on amendment, and the
   * composite `externalId` deliberately omits `AMEND_ID` so a later version
   * upserts over the earlier one (#980). That merge is last-write-wins, which
   * assumes the export lists a filing's amendments in ascending order. It does
   * not always: 454 `RCPT_CD` rows on the 2026-08-09 export carry a
   * *decreasing* `AMEND_ID`, so the superseded version lands last and wins.
   *
   * That was harmless while nothing read `amend_id`. It is not harmless now —
   * `AmendmentSupersessionService` deletes every row below `max(amend_id)` for
   * a filing, so a current row left holding a stale `amend_id` is deleted
   * outright and its money disappears from the committee's total. Ordering the
   * write by `amendId` rather than by arrival removes the dependency on file
   * order entirely (#992).
   *
   * Rows carrying no `amendId` keep the previous last-write-wins behaviour:
   * with nothing to compare, arrival order is the only signal there is.
   */
  private keepNewestAmendment(
    incoming: Record<string, unknown>[],
    existing: { externalId: string; amendId?: number | null }[],
  ): Record<string, unknown>[] {
    const newest = new Map<string, Record<string, unknown>>();
    for (const row of incoming) {
      const id = row.externalId as string;
      const held = newest.get(id);
      if (!held || !isOlderAmendment(row, held)) newest.set(id, row);
    }

    const storedAmend = new Map(
      existing.map((r) => [r.externalId, r.amendId ?? undefined]),
    );
    const kept = [...newest.values()].filter(
      (row) =>
        !isOlderAmendment(row, {
          amendId: storedAmend.get(row.externalId as string),
        }),
    );

    const dropped = incoming.length - kept.length;
    if (dropped > 0) {
      this.logger.debug(
        `Collapsed ${dropped} row(s) in batch onto a same-or-newer version of ` +
          `the same externalId`,
      );
    }
    return kept;
  }
}

/**
 * True when `candidate` is an *older* version of the same row than `other`, and
 * so must not overwrite it. Equal amendments may overwrite: re-syncing the same
 * version has to stay idempotent. An absent `amendId` on either side yields
 * `false` — unordered, so arrival order decides, as it did before #992.
 */
function isOlderAmendment(
  candidate: { amendId?: unknown },
  other: { amendId?: unknown },
): boolean {
  const a = candidate.amendId;
  const b = other.amendId;
  return typeof a === 'number' && typeof b === 'number' && a < b;
}
