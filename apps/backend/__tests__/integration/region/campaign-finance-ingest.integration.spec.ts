/**
 * Campaign-finance ingest, end to end against a real `postgres_test`
 * (`docs/plans/campaign-finance-phase-b.md`).
 *
 * The real handler, the real domain mapper and the real sync service, with
 * only the HTTP fetch stubbed. The claim under test spans all three: the
 * sha256 the handler stamps on each export line must survive the mapper's
 * schemas and reach the row. It never did (F3). The handler spec ran a mock
 * mapper that passed records through, and the bulk-archive spec wrote the
 * hash itself, so no test crossed the seam where it was dropped.
 *
 * The donors are invented. No line here comes from a real export.
 */

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import {
  createBulkDownloadScope,
  emptyCampaignFinanceResult,
  type DataSourceConfig,
} from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  BulkDownloadHandler,
  DomainMapperService,
  ExecutionTrackerService,
} from '@opuspopuli/scraping-pipeline';
import { AmendmentSupersessionService } from '../../../src/apps/region/src/domains/amendment-supersession.service';
import { CampaignFinanceSyncService } from '../../../src/apps/region/src/domains/campaign-finance-sync.service';
import { PrismaBulkArchive } from '../../../src/apps/region/src/infrastructure/prisma-bulk-archive';
import { PrismaBulkImportLedger } from '../../../src/apps/region/src/infrastructure/prisma-bulk-import-ledger';
import { PrismaExecutionTrackerRepository } from '../../../src/apps/region/src/infrastructure/prisma-execution-tracker-repository';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const HEADER = [
  'FILING_ID',
  'AMEND_ID',
  'LINE_ITEM',
  'TRAN_ID',
  'FORM_TYPE',
  'ENTITY_CD',
  'CTRIB_NAML',
  'CTRIB_NAMF',
  'AMOUNT',
  'RCPT_DATE',
].join('\t');
const LINES = [
  [
    '9000001',
    '0',
    '1',
    'T1',
    'A',
    'IND',
    'Example',
    'Ada',
    '250',
    '3/1/2026 12:00:00 AM',
  ],
  [
    '9000001',
    '0',
    '2',
    'T2',
    'A',
    'IND',
    'Sample',
    'Ben',
    '75',
    '3/2/2026 12:00:00 AM',
  ],
].map((cells) => cells.join('\t'));

const SOURCE = {
  url: 'https://example.test/finance.tsv',
  dataType: 'campaign_finance',
  sourceType: 'bulk_download',
  category: 'CAL-ACCESS Contributions',
  bulk: {
    format: 'tsv',
    compositeKey: ['FILING_ID', 'LINE_ITEM', 'TRAN_ID'],
    columnMappings: {
      FILING_ID: 'filingId',
      AMEND_ID: 'amendId',
      FORM_TYPE: 'scheduleCode',
      ENTITY_CD: 'donorType',
      CTRIB_NAML: 'donorLastName',
      CTRIB_NAMF: 'donorFirstName',
      AMOUNT: 'amount',
      RCPT_DATE: 'date',
    },
  },
} as unknown as DataSourceConfig;

const EXPENDITURE_SOURCE = {
  ...SOURCE,
  category: 'CAL-ACCESS Expenditures',
  bulk: {
    format: 'tsv',
    compositeKey: ['FILING_ID', 'LINE_ITEM', 'TRAN_ID'],
    // The contribution file read as expenditures: enough to land rows in a
    // second table from the same download.
    columnMappings: { CTRIB_NAML: 'payeeName', AMOUNT: 'amount' },
  },
} as unknown as DataSourceConfig;

/** Cover pages key on FILING_ID alone: one row per filing, one line per amendment. */
const COVER_PAGE_SOURCE = {
  url: 'https://example.test/cover-pages.tsv',
  dataType: 'campaign_finance',
  sourceType: 'bulk_download',
  category: 'CAL-ACCESS IE Cover Pages',
  bulk: {
    format: 'tsv',
    columnMappings: {
      FILING_ID: 'filingId',
      FILER_ID: 'filerId',
      CAND_NAML: 'candidateName',
    },
  },
} as unknown as DataSourceConfig;
const COVER_PAGE_LINES = [
  ['9000002', '0', '1400001', 'Original'],
  ['9000002', '1', '1400001', 'Amended'],
].map((cells) => cells.join('\t'));
const COVER_PAGE_BODY =
  [['FILING_ID', 'AMEND_ID', 'FILER_ID', 'CAND_NAML'].join('\t')]
    .concat(COVER_PAGE_LINES)
    .join('\n') + '\n';

/**
 * One filing, amended once. Amendment 1 restates the line under a new
 * TRAN_ID, as CAL-ACCESS does, so the two lines key to different rows.
 */
const AMENDED_LINES = [
  [
    '9000003',
    '0',
    '1',
    'INC1',
    'A',
    'IND',
    'Example',
    'Cy',
    '250',
    '3/3/2026 12:00:00 AM',
  ],
  [
    '9000003',
    '1',
    '1',
    'CR1',
    'A',
    'IND',
    'Example',
    'Cy',
    '260',
    '3/3/2026 12:00:00 AM',
  ],
].map((cells) => cells.join('\t'));

/**
 * Two filings shaped like the S496 and CVR2 sources in regions 1.0.106: keyed
 * on FILING_ID + LINE_ITEM + TRAN_ID, with AMEND_ID mapped (F8). Each is
 * amended once and restated under a new TRAN_ID, as RCPT is above.
 */
const IE_SOURCE = {
  url: 'https://example.test/s496.tsv',
  dataType: 'campaign_finance',
  sourceType: 'bulk_download',
  category: 'CAL-ACCESS Independent Expenditures',
  bulk: {
    format: 'tsv',
    compositeKey: ['FILING_ID', 'LINE_ITEM', 'TRAN_ID'],
    columnMappings: {
      FILING_ID: 'filingId',
      AMEND_ID: 'amendId',
      AMOUNT: 'amount',
      EXP_DATE: 'date',
    },
  },
} as unknown as DataSourceConfig;
const IE_BODY =
  [
    ['FILING_ID', 'AMEND_ID', 'LINE_ITEM', 'TRAN_ID', 'AMOUNT', 'EXP_DATE'],
    ['9000004', '1', '1', 'IE1R', '1200', '3/4/2026 12:00:00 AM'],
    ['9000004', '0', '1', 'IE1', '1000', '3/4/2026 12:00:00 AM'],
  ]
    .map((cells) => cells.join('\t'))
    .join('\n') + '\n';

const MEASURE_SOURCE = {
  url: 'https://example.test/cvr2.tsv',
  dataType: 'campaign_finance',
  sourceType: 'bulk_download',
  category: 'CAL-ACCESS Committee Positions',
  bulk: {
    format: 'tsv',
    compositeKey: ['FILING_ID', 'LINE_ITEM', 'TRAN_ID'],
    columnMappings: {
      FILING_ID: 'filingId',
      AMEND_ID: 'amendId',
      BAL_NAME: 'ballotName',
      BAL_NUM: 'ballotNumber',
      SUP_OPP_CD: 'supportOrOppose',
    },
  },
} as unknown as DataSourceConfig;
const MEASURE_BODY =
  [
    [
      'FILING_ID',
      'AMEND_ID',
      'LINE_ITEM',
      'TRAN_ID',
      'BAL_NAME',
      'BAL_NUM',
      'SUP_OPP_CD',
    ],
    ['9000005', '1', '1', 'M1R', 'Example Measure', '99', 'O'],
    ['9000005', '0', '1', 'M1', 'Example Measure', '99', 'S'],
  ]
    .map((cells) => cells.join('\t'))
    .join('\n') + '\n';

type FinanceProvider = Parameters<CampaignFinanceSyncService['sync']>[0];
type OnBatch = NonNullable<
  Parameters<NonNullable<FinanceProvider['fetchCampaignFinance']>>[0]
>;

/** A provider that streams through `run` and returns nothing more. */
function providerFrom(
  run: (onBatch: OnBatch) => Promise<void>,
): FinanceProvider {
  return {
    fetchCampaignFinance: async (onBatch: OnBatch) => {
      await run(onBatch);
      return emptyCampaignFinanceResult();
    },
  } as FinanceProvider;
}

/** The sync service with supersession bound, so F7 is on. */
function supersedingSync(db: DbService): CampaignFinanceSyncService {
  return new CampaignFinanceSyncService(
    db,
    undefined,
    undefined,
    undefined,
    undefined,
    new AmendmentSupersessionService(db),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exportResponse(body: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: Readable.from([Buffer.from(body)]),
  };
}

describe('campaign-finance ingest (real DB)', () => {
  let db: DbService;
  let sync: CampaignFinanceSyncService;
  let handler: BulkDownloadHandler;
  const realFetch = global.fetch;

  beforeAll(async () => {
    db = await getDbService();
    sync = new CampaignFinanceSyncService(db);
    handler = new BulkDownloadHandler(new DomainMapperService());
  });

  beforeEach(async () => {
    await cleanDatabase();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        exportResponse([HEADER, ...LINES].join('\n') + '\n'),
      ) as unknown as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await disconnectDatabase();
  });

  it('stores the sha256 of each export line on the row it produced (F3)', async () => {
    await sync.sync(
      providerFrom(async (onBatch) => {
        await handler.execute(SOURCE, 'california', onBatch);
      }),
    );

    const rows = await db.contribution.findMany({
      orderBy: { externalId: 'asc' },
      select: { externalId: true, sourceRecordHash: true },
    });

    expect(rows).toEqual([
      { externalId: '9000001:1:T1', sourceRecordHash: sha256(LINES[0]) },
      { externalId: '9000001:2:T2', sourceRecordHash: sha256(LINES[1]) },
    ]);
  });

  describe('skipping unchanged rows and linking runs to snapshots (K4, D5)', () => {
    let bodies: Record<string, string>;
    let tracked: BulkDownloadHandler;

    beforeEach(() => {
      bodies = {
        [SOURCE.url]: [HEADER, ...LINES].join('\n') + '\n',
        [COVER_PAGE_SOURCE.url]: COVER_PAGE_BODY,
      };
      global.fetch = jest.fn(async (url: string) =>
        exportResponse(bodies[url]),
      ) as unknown as typeof fetch;
      tracked = new BulkDownloadHandler(
        new DomainMapperService(),
        new ExecutionTrackerService(new PrismaExecutionTrackerRepository(db)),
        new PrismaBulkArchive(db, null, new ConfigService()),
        null,
        new PrismaBulkImportLedger(db),
      );
    });

    /** One sync of `sources`, under its own job, sharing one download. */
    async function importOnce(
      jobId: string,
      sources: DataSourceConfig[] = [SOURCE],
      service: CampaignFinanceSyncService = sync,
    ) {
      const job = await db.pipelineJob.create({
        data: {
          bullmqJobId: jobId,
          triggerSource: 'manual',
          dataTypes: ['campaign_finance'],
          status: 'running',
        },
      });
      const scope = createBulkDownloadScope();
      try {
        return await service.sync(
          providerFrom(async (onBatch) => {
            for (const source of sources) {
              await tracked.execute(
                source,
                'california',
                onBatch,
                job.id,
                scope,
              );
            }
          }),
        );
      } finally {
        await scope.close();
      }
    }

    it('writes every row once, then skips them when nothing changed', async () => {
      const first = await importOnce('a');
      const second = await importOnce('b');

      expect(first).toMatchObject({ created: 2, skipped: 0 });
      expect(second).toMatchObject({ created: 0, updated: 0, skipped: 2 });
    });

    it('rewrites only the line that changed', async () => {
      await importOnce('a');
      bodies[SOURCE.url] =
        [HEADER, LINES[0], LINES[1].replace('\t75\t', '\t80\t')].join('\n') +
        '\n';

      const second = await importOnce('b');

      expect(second).toMatchObject({ updated: 1, skipped: 1 });
      const changed = await db.contribution.findUnique({
        where: { externalId: '9000001:2:T2' },
        select: { amount: true },
      });
      expect(Number(changed!.amount)).toBe(80);
    });

    it('keeps the last line of a key that appears twice in one batch', async () => {
      // UAT run 2 left 21,061 cover pages holding an earlier amendment: the
      // skip matched the stored (last) line and wrote only the earlier one.
      await importOnce('a', [COVER_PAGE_SOURCE]);
      const second = await importOnce('b', [COVER_PAGE_SOURCE]);

      const row = await db.cvrFiling.findUnique({
        where: { externalId: '9000002' },
        select: { candidateName: true, sourceRecordHash: true },
      });
      expect(row).toEqual({
        candidateName: 'Amended',
        sourceRecordHash: sha256(COVER_PAGE_LINES[1]),
      });
      expect(second).toMatchObject({ skipped: 0 });
    });

    it('keeps the last line of a key whose lines fall in different batches', async () => {
      // No guard covers this: each batch reads the stored row after the
      // previous batch committed, so the last line is compared with the
      // earlier line this sync just wrote and is written too.
      const oneLinePerBatch = {
        ...COVER_PAGE_SOURCE,
        bulk: { ...COVER_PAGE_SOURCE.bulk, batchSize: 1 },
      } as DataSourceConfig;
      await importOnce('a', [oneLinePerBatch]);
      await importOnce('b', [oneLinePerBatch]);

      const row = await db.cvrFiling.findUnique({
        where: { externalId: '9000002' },
        select: { candidateName: true },
      });
      expect(row).toEqual({ candidateName: 'Amended' });
    });

    it('does not recreate a superseded line, and ends as supersession would leave it (F7)', async () => {
      // Each sync used to re-insert the amendment-0 row, then supersession
      // deleted it again: ~3.9 M times per sync on the 11-02 export.
      const superseding = supersedingSync(db);
      bodies[SOURCE.url] = [HEADER, ...AMENDED_LINES].join('\n') + '\n';

      const first = await importOnce('a', [SOURCE], superseding);
      const second = await importOnce('b', [SOURCE], superseding);

      // Both lines share a batch, so even the first sync drops amendment 0.
      expect(first).toMatchObject({ created: 1, superseded: 1 });
      expect(second).toMatchObject({ created: 0, updated: 0, superseded: 1 });
      const rows = await db.contribution.findMany({
        where: { filingId: '9000003' },
        select: { externalId: true, amendId: true, amount: true },
      });
      expect(
        rows.map((r) => [r.externalId, r.amendId, Number(r.amount)]),
      ).toEqual([['9000003:1:CR1', 1, 260]]);
    });

    it('drops a superseded line in a later batch than its amendment (F7)', async () => {
      // One line per batch: amendment 0 arrives after amendment 1 committed,
      // so only the stored max can drop it.
      const superseding = supersedingSync(db);
      bodies[SOURCE.url] =
        [HEADER, AMENDED_LINES[1], AMENDED_LINES[0]].join('\n') + '\n';
      const oneLinePerBatch = {
        ...SOURCE,
        bulk: { ...SOURCE.bulk, batchSize: 1 },
      } as DataSourceConfig;

      const first = await importOnce('a', [oneLinePerBatch], superseding);

      expect(first).toMatchObject({ created: 1, superseded: 1 });
      const ids = await db.contribution.findMany({
        where: { filingId: '9000003' },
        select: { externalId: true },
      });
      expect(ids).toEqual([{ externalId: '9000003:1:CR1' }]);
    });

    it.each([
      {
        table: 'independentExpenditures' as const,
        source: IE_SOURCE,
        body: IE_BODY,
        filingId: '9000004',
        latest: '9000004:1:IE1R',
      },
      {
        table: 'committeeMeasureFilings' as const,
        source: MEASURE_SOURCE,
        body: MEASURE_BODY,
        filingId: '9000005',
        latest: '9000005:1:M1R',
      },
    ])(
      'stores amendId on $table and keeps only the latest amendment (F8)',
      async ({ table, source, body, filingId, latest }) => {
        // One line per batch, newest first: amendment 0 can only be dropped
        // against the stored amend_id, so a write path that loses amendId
        // leaves both rows and counts the filing twice.
        bodies[source.url] = body;
        const oneLinePerBatch = {
          ...source,
          bulk: { ...source.bulk, batchSize: 1 },
        } as DataSourceConfig;

        const first = await importOnce(
          'a',
          [oneLinePerBatch],
          supersedingSync(db),
        );

        expect(first).toMatchObject({ created: 1, superseded: 1 });
        const model = {
          independentExpenditures: db.independentExpenditure,
          committeeMeasureFilings: db.cvr2Filing,
        }[table];
        const rows = await (
          model.findMany as (args: unknown) => Promise<unknown[]>
        )({
          where: { filingId },
          select: { externalId: true, amendId: true },
        });
        expect(rows).toEqual([{ externalId: latest, amendId: 1 }]);
      },
    );

    it('rewrites every row once when the source mapping changes', async () => {
      await importOnce('a');
      const remapped = {
        ...SOURCE,
        bulk: { ...SOURCE.bulk, batchSize: 500 },
      } as DataSourceConfig;

      const second = await importOnce('b', [remapped]);

      expect(second).toMatchObject({ updated: 2, skipped: 0 });
    });

    it('writes every row after a run under another key died partway', async () => {
      // A new mapping starts, rewrites the first batch, and fails. Rolled back
      // to the old mapping, the next sync must not skip on the old entry:
      // that row now holds the failed run's mapping.
      await importOnce('a');
      const remapped = {
        ...SOURCE,
        bulk: { ...SOURCE.bulk, batchSize: 1 },
      } as DataSourceConfig;
      const job = await db.pipelineJob.create({
        data: {
          bullmqJobId: 'b',
          triggerSource: 'manual',
          dataTypes: ['campaign_finance'],
          status: 'running',
        },
      });
      await sync
        .sync(
          providerFrom(async (onBatch) => {
            let batches = 0;
            await tracked.execute<Record<string, unknown>>(
              remapped,
              'california',
              async (items, context) => {
                if (batches++ > 0) throw new Error('worker died');
                await onBatch(items, context);
              },
              job.id,
            );
            throw new Error('worker died');
          }),
        )
        .catch(() => undefined);

      const rolledBack = await importOnce('c');

      expect(rolledBack).toMatchObject({ updated: 2, skipped: 0 });
    });

    it('links every run reading one download to one snapshot, and rows to their run', async () => {
      // Two sources on one export, as California's seven are (D4, F5).
      const sameExport = { ...EXPENDITURE_SOURCE, url: SOURCE.url };

      await importOnce('a', [SOURCE, sameExport]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const runs = await db.pipelineExecution.findMany({
        select: { id: true, bulkSnapshotId: true },
      });
      expect(runs).toHaveLength(2);
      expect(runs[0].bulkSnapshotId).not.toBeNull();
      expect(runs[1].bulkSnapshotId).toBe(runs[0].bulkSnapshotId);

      // Rows name the run that wrote them, on the tables that gained the
      // column as well as on contributions.
      const contribution = await db.contribution.findFirst({
        select: { pipelineExecutionId: true },
      });
      const expenditure = await db.expenditure.findFirst({
        select: { pipelineExecutionId: true },
      });
      expect(contribution!.pipelineExecutionId).not.toBeNull();
      expect(expenditure!.pipelineExecutionId).not.toBeNull();
      expect(expenditure!.pipelineExecutionId).not.toBe(
        contribution!.pipelineExecutionId,
      );
      expect(runs.map((r) => r.id).sort()).toEqual(
        [
          contribution!.pipelineExecutionId,
          expenditure!.pipelineExecutionId,
        ].sort(),
      );
    });
  });
});
