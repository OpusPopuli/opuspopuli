import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  batchTransaction,
  type CampaignFinanceResult,
} from '@opuspopuli/common';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
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
  findMany(args: unknown): Promise<{ externalId: string }[]>;
  upsert(args: unknown): Prisma.PrismaPromise<unknown>;
};

type UpsertConfig = {
  records: readonly unknown[];
  model: PrismaModelDelegate;
  fields: string[];
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
      data.committeeMeasureFilings.length > 0
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

    if (this.propositionFinanceLinker) {
      try {
        await this.propositionFinanceLinker.linkAll();
      } catch (error) {
        this.logger.warn(
          `Proposition finance linker failed: ${(error as Error).message}`,
        );
      }
    }

    return {
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
    };
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
              type: 'OTHER',
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

    for (const c of data.contributions) {
      c.committeeId = idMap.get(c.committeeId) ?? c.committeeId;
    }
    for (const e of data.expenditures) {
      e.committeeId = idMap.get(e.committeeId) ?? e.committeeId;
    }
    for (const ie of data.independentExpenditures) {
      ie.committeeId = idMap.get(ie.committeeId) ?? ie.committeeId;
    }
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
            party: c.party ?? null,
            status: c.status ?? 'active',
            sourceSystem: c.sourceSystem,
            sourceUrl: c.sourceUrl ?? null,
          },
          update: {
            name: c.name,
            type: c.type,
            sourceSystem: c.sourceSystem,
            ...(c.candidateName ? { candidateName: c.candidateName } : {}),
            ...(c.candidateOffice
              ? { candidateOffice: c.candidateOffice }
              : {}),
            ...(c.party ? { party: c.party } : {}),
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
   * Route a heterogeneous batch of records (everything CAL-ACCESS streams
   * out) into the typed shape `CampaignFinanceResult` expects. Discrimination
   * is by field presence rather than a wire-format type tag — the upstream
   * bulk downloads don't carry one.
   */
  private sortItems(items: Record<string, unknown>[]): CampaignFinanceResult {
    const committees: CampaignFinanceResult['committees'] = [];
    const contributions: CampaignFinanceResult['contributions'] = [];
    const expenditures: CampaignFinanceResult['expenditures'] = [];
    const independentExpenditures: CampaignFinanceResult['independentExpenditures'] =
      [];
    const committeeMeasureFilings: CampaignFinanceResult['committeeMeasureFilings'] =
      [];

    for (const rec of items) {
      if ('donorName' in rec && 'amount' in rec) {
        contributions.push(
          rec as unknown as CampaignFinanceResult['contributions'][0],
        );
      } else if ('payeeName' in rec && 'amount' in rec) {
        expenditures.push(
          rec as unknown as CampaignFinanceResult['expenditures'][0],
        );
      } else if ('supportOrOppose' in rec && 'committeeName' in rec) {
        independentExpenditures.push(
          rec as unknown as CampaignFinanceResult['independentExpenditures'][0],
        );
      } else if (
        'filingId' in rec &&
        ('ballotName' in rec || 'ballotNumber' in rec)
      ) {
        committeeMeasureFilings.push(
          rec as unknown as CampaignFinanceResult['committeeMeasureFilings'][0],
        );
      } else if ('sourceSystem' in rec && 'type' in rec) {
        committees.push(
          rec as unknown as CampaignFinanceResult['committees'][0],
        );
      }
    }

    return {
      committees,
      contributions,
      expenditures,
      independentExpenditures,
      committeeMeasureFilings,
    };
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
        fields: [
          'committeeId',
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
        fields: [
          'committeeId',
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
    ];

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const config of upsertConfigs) {
      if (config.records.length === 0) continue;
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
   */
  private async upsertRecordsByFields(
    config: UpsertConfig,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const { model, fields } = config;
    const rows = config.records as Record<string, unknown>[];
    const externalIds = rows.map((r) => r.externalId as string);

    const existing = await model.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingSet = new Set(
      existing.map((r: { externalId: string }) => r.externalId),
    );

    const pick = (r: Record<string, unknown>) =>
      Object.fromEntries(fields.map((f: string) => [f, r[f]]));

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
}
