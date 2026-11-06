/**
 * Bills from the Legislature's pubinfo export, end to end on a real database
 * (`docs/plans/bills-phase-b.md`, D9–D17): mirror rows written and skipped,
 * then bills, co-authors and votes derived from the mirrors.
 *
 * Bills, legislators and districts are invented. Representatives are public
 * officials, but fixtures still use made-up names.
 */
import { createHash } from 'node:crypto';
import type { BulkBatchContext, PubinfoRow } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  BillsPubinfoSyncService,
  type BillsBulkProvider,
} from '../../../src/apps/region/src/domains/bills-pubinfo-sync.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const SESSION = '20252026';
const STATUS_LIFECYCLE = {
  'In Committee Process': 'active',
  Chaptered: 'enacted',
  Vetoed: 'dead',
} as const;
/** Mid-session, so 2025-2026 is open. */
const TODAY = new Date('2026-10-22T12:00:00Z');

const hash = (row: object) =>
  createHash('sha256').update(JSON.stringify(row)).digest('hex');

/** `Omit` that keeps each member of a union apart. */
type Unhashed = PubinfoRow extends infer R
  ? R extends PubinfoRow
    ? Omit<R, 'sourceRecordHash'>
    : never
  : never;

/** Each row hashed by its content, as the handler hashes the export line. */
const withHash = (row: Unhashed): PubinfoRow =>
  ({ ...row, sourceRecordHash: hash(row) }) as PubinfoRow;

function exportRows(billStatus: string): PubinfoRow[] {
  return [
    withHash({
      table: 'LEGISLATOR_TBL',
      externalId: `${SESSION}:AD07:A:Example`,
      district: 'AD07',
      sessionYear: SESSION,
      legislatorName: 'Example, Ada',
      houseType: 'A',
      authorName: 'Example',
    }),
    withHash({
      table: 'LEGISLATOR_TBL',
      externalId: `${SESSION}:SD03:S:Sample`,
      district: 'SD03',
      sessionYear: SESSION,
      legislatorName: 'Sample, Ben',
      houseType: 'S',
      authorName: 'Sample',
    }),
    withHash({
      table: 'LOCATION_CODE_TBL',
      externalId: `${SESSION}:CX25:`,
      sessionYear: SESSION,
      locationCode: 'CX25',
      description: 'Asm Appropriations',
    }),
    withHash({
      table: 'BILL_MOTION_TBL',
      externalId: '7',
      motionText: 'Do pass.',
    }),
    withHash({
      table: 'BILL_TBL',
      externalId: '202520260AB9001',
      sessionYear: SESSION,
      measureType: 'AB',
      measureNum: 9001,
      latestBillVersionId: '20250AB900198AMD',
      currentStatus: billStatus,
    }),
    withHash({
      table: 'BILL_VERSION_TBL',
      externalId: '20250AB900199INT',
      billId: '202520260AB9001',
      versionNum: 99,
      billVersionActionDate: '2025-02-01',
      subject: 'Example subject, as introduced.',
      billXml: '<caml:Title>An act as introduced.</caml:Title>',
    }),
    withHash({
      table: 'BILL_VERSION_TBL',
      externalId: '20250AB900198AMD',
      billId: '202520260AB9001',
      versionNum: 98,
      billVersionActionDate: '2025-04-01',
      subject: 'Example subject.',
      billXml:
        '<caml:Title>An act to add Section 1 to the <i>Example</i> Code, relating to examples. </caml:Title>',
    }),
    withHash({
      table: 'BILL_VERSION_AUTHORS_TBL',
      externalId: '20250AB900198AMD:Legislator:ASSEMBLY:Example:LEAD_AUTHOR',
      billVersionId: '20250AB900198AMD',
      type: 'Legislator',
      house: 'ASSEMBLY',
      name: 'Example',
      contribution: 'LEAD_AUTHOR',
    }),
    withHash({
      table: 'BILL_VERSION_AUTHORS_TBL',
      externalId: '20250AB900198AMD:Legislator:SENATE:Sample:COAUTHOR',
      billVersionId: '20250AB900198AMD',
      type: 'Legislator',
      house: 'SENATE',
      name: 'Senator Sample',
      contribution: 'COAUTHOR',
    }),
    withHash({
      table: 'BILL_HISTORY_TBL',
      externalId: '1',
      billId: '202520260AB9001',
      actionDate: '2025-04-01',
      action: 'Referred to Com. on APPR.',
      actionSequence: 1,
    }),
    withHash({
      table: 'BILL_HISTORY_TBL',
      externalId: '2',
      billId: '202520260AB9001',
      actionDate: '2025-04-01',
      action: 'From committee: Do pass.',
      actionSequence: 2,
    }),
    withHash({
      table: 'BILL_DETAIL_VOTE_TBL',
      externalId: `202520260AB9001:CX25:Example:2025-04-01 10:00:00:1:7`,
      billId: '202520260AB9001',
      locationCode: 'CX25',
      legislatorName: 'Example',
      voteDateTime: '2025-04-01 10:00:00',
      voteDateSeq: 1,
      voteCode: 'AYE',
      motionId: 7,
    }),
  ];
}

/** A provider that streams `rows` in one batch, as `fetchBillsBulk` would. */
const providerOf = (
  rows: PubinfoRow[],
  context: BulkBatchContext,
): BillsBulkProvider => ({
  fetchBillsBulk: async (onBatch) => onBatch(rows, context),
});

describe('Bills from the pubinfo export (bills-phase-b.md, D9-D17)', () => {
  let db: DbService;
  let sync: BillsPubinfoSyncService;
  const run = (rows: PubinfoRow[], skipUnchanged = true) =>
    sync.sync(providerOf(rows, { skipUnchanged }), {
      regionId: 'california',
      statusLifecycle: STATUS_LIFECYCLE,
      today: TODAY,
    });

  beforeAll(async () => {
    db = await getDbService();
    sync = new BillsPubinfoSyncService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
    await db.representative.createMany({
      data: [
        {
          externalId: 'rep-ad7',
          name: 'Ada Example',
          chamber: 'Assembly',
          district: '7',
        },
        {
          externalId: 'rep-sd3',
          name: 'Ben Sample',
          chamber: 'Senate',
          district: '3',
        },
      ],
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('derives the bill from the mirrors', async () => {
    const result = await run(exportRows('In Committee Process'), false);

    expect(result.derived).toBe(1);
    const bill = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB9001' },
    });
    expect(bill).toMatchObject({
      billNumber: 'AB 9001',
      sessionYear: '2025-2026',
      measureTypeCode: 'AB',
      // The current version is the lowest version_num (D17).
      title:
        'An act to add Section 1 to the Example Code, relating to examples.',
      subject: 'Example subject.',
      status: 'In Committee Process',
      statusSource: 'official',
      lastAction: 'From committee: Do pass.',
      lastActionDate: new Date('2025-04-01T00:00:00Z'),
      authorName: 'Example',
      isActive: true,
      isDead: false,
    });
  });

  it('links the author, co-authors and votes by seat (D15, D16)', async () => {
    await run(exportRows('In Committee Process'), false);

    const bill = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB9001' },
      include: { coAuthors: true, votes: true },
    });
    const ada = await db.representative.findUniqueOrThrow({
      where: { externalId: 'rep-ad7' },
    });
    const ben = await db.representative.findUniqueOrThrow({
      where: { externalId: 'rep-sd3' },
    });
    expect(bill.authorId).toBe(ada.id);
    // "Senator Sample" in the author list still reaches the Senate seat.
    expect(bill.coAuthors).toEqual([
      expect.objectContaining({
        representativeId: ben.id,
        coAuthorType: 'coauthor',
      }),
    ]);
    expect(bill.votes).toEqual([
      expect.objectContaining({
        representativeId: ada.id,
        representativeName: 'Example',
        chamber: 'Assembly Appropriations',
        position: 'yes',
        motionText: 'Do pass.',
        voteDate: new Date('2025-04-01T00:00:00Z'),
      }),
    ]);
  });

  it('writes and derives nothing when the export has not changed (K4)', async () => {
    await run(exportRows('In Committee Process'), false);

    const second = await run(exportRows('In Committee Process'));

    expect(second).toMatchObject({ created: 0, updated: 0, derived: 0 });
    expect(second.skipped).toBe(second.processed);
  });

  it('re-derives only the bill whose line changed, and moves its lifecycle', async () => {
    await run(exportRows('In Committee Process'), false);

    const after = await run(exportRows('Vetoed'));

    expect(after).toMatchObject({ updated: 1, derived: 1 });
    const bill = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB9001' },
    });
    expect(bill).toMatchObject({ isActive: false, isDead: true });
  });

  it('keeps the stored lifecycle for a status the map does not name', async () => {
    await run(exportRows('In Committee Process'), false);

    await run(exportRows('Some New Status'));

    const bill = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB9001' },
    });
    expect(bill).toMatchObject({
      status: 'Some New Status',
      isActive: true,
      isDead: false,
    });
  });

  it('updates a bill the page path wrote, keeping its row', async () => {
    const legacy = await db.bill.create({
      data: {
        externalId: '202520260AB9001',
        regionId: 'california',
        billNumber: 'AB 9001',
        sessionYear: '2025-2026',
        measureTypeCode: 'AB',
        title: 'Old title',
        status: 'Amended IN Assembly April 1, 2025',
        sourceUrl: 'https://example.test/old',
        isActive: false,
      },
    });

    await run(exportRows('In Committee Process'), false);

    const bill = await db.bill.findUniqueOrThrow({
      where: { externalId: '202520260AB9001' },
    });
    // Same row (votes and caches keyed on it survive), now official: the B8
    // repair for a bill whose status an LLM had overwritten.
    expect(bill.id).toBe(legacy.id);
    expect(bill).toMatchObject({
      status: 'In Committee Process',
      statusSource: 'official',
      isActive: true,
    });
  });
});
