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
      lastName: 'Example',
    }),
    withHash({
      table: 'LEGISLATOR_TBL',
      externalId: `${SESSION}:SD03:S:Sample`,
      district: 'SD03',
      sessionYear: SESSION,
      legislatorName: 'Sample, Ben',
      houseType: 'S',
      authorName: 'Sample',
      lastName: 'Sample',
    }),
    withHash({
      table: 'LOCATION_CODE_TBL',
      externalId: `${SESSION}:CX25:`,
      sessionYear: SESSION,
      locationCode: 'CX25',
      description: 'Asm Appropriations',
      longDescription: 'Appropriations',
    }),
    withHash({
      table: 'LOCATION_CODE_TBL',
      externalId: `${SESSION}:CS61:`,
      sessionYear: SESSION,
      locationCode: 'CS61',
      description: 'Sen Appropriations',
      longDescription: 'Appropriations',
    }),
    // Heard in Assembly Appropriations once and Senate Appropriations twice.
    ...[
      ['CX25', '2025-04-01'],
      ['CS61', '2025-06-01'],
      ['CS61', '2025-06-15'],
    ].map(([code, date]) =>
      withHash({
        table: 'COMMITTEE_HEARING_TBL',
        externalId: `202520260AB9001:${code}:${date}:${date} 09:00:00`,
        billId: '202520260AB9001',
        committeeType: code.slice(0, 2),
        committeeNr: Number(code.slice(2)),
        hearingDate: date,
        locationCode: code,
        transUpdateDate: `${date} 09:00:00`,
      }),
    ),
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
          regionId: 'california',
          name: 'Ada Example',
          chamber: 'Assembly',
          district: '7',
        },
        // Another state's member in the same seat, with the same surname.
        {
          externalId: 'other-ad7',
          regionId: 'elsewhere',
          name: 'Bo Example',
          chamber: 'Assembly',
          district: '7',
        },
        {
          externalId: 'rep-sd3',
          regionId: 'california',
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

  it('keeps each same-day roll call, not one vote per day', async () => {
    // Second reading and reconsideration on one day: the member votes twice.
    const rows = [
      ...exportRows('In Committee Process'),
      withHash({
        table: 'BILL_DETAIL_VOTE_TBL',
        externalId: `202520260AB9001:CX25:Example:2025-04-01 15:00:00:2:7`,
        billId: '202520260AB9001',
        locationCode: 'CX25',
        legislatorName: 'Example',
        voteDateTime: '2025-04-01 15:00:00',
        voteDateSeq: 2,
        voteCode: 'NOE',
        motionId: 7,
      }),
    ];

    await run(rows, false);

    const votes = await db.billVote.findMany({
      where: { bill: { externalId: '202520260AB9001' } },
      orderBy: { rollCall: 'asc' },
    });
    expect(votes.map((v) => [v.rollCall, v.position])).toEqual([
      ['CX25:2025-04-01 10:00:00:1', 'yes'],
      ['CX25:2025-04-01 15:00:00:2', 'no'],
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

  it('derives a bill a failed derive left behind, though no line changed', async () => {
    await run(exportRows('In Committee Process'), false);
    // As a derive that died after the import was recorded complete leaves it.
    await db.pubinfoBill.update({
      where: { externalId: '202520260AB9001' },
      data: { derivedAt: null },
    });

    const again = await run(exportRows('In Committee Process'));

    expect(again).toMatchObject({ updated: 0, derived: 1 });
  });

  it('re-derives a bill when only its author row changed', async () => {
    await run(exportRows('In Committee Process'), false);
    const rows = exportRows('In Committee Process').map((row) =>
      row.table === 'BILL_VERSION_AUTHORS_TBL' &&
      row.contribution === 'COAUTHOR'
        ? withHash({ ...row, contribution: 'PRINCIPAL_COAUTHOR' } as Unhashed)
        : row,
    );

    const after = await run(rows);

    expect(after).toMatchObject({ updated: 1, derived: 1 });
    const coAuthors = await db.billCoAuthor.findMany();
    expect(coAuthors.map((c) => c.coAuthorType)).toEqual([
      'principal_coauthor',
    ]);
  });

  /** A second bill, with no votes, so "every bill" and "this bill" differ. */
  const secondBill = (): PubinfoRow[] => [
    withHash({
      table: 'BILL_TBL',
      externalId: '202520260AB9002',
      sessionYear: SESSION,
      measureType: 'AB',
      measureNum: 9002,
      latestBillVersionId: '20250AB900299INT',
      currentStatus: 'In Committee Process',
    }),
    withHash({
      table: 'BILL_VERSION_TBL',
      externalId: '20250AB900299INT',
      billId: '202520260AB9002',
      versionNum: 99,
      billVersionActionDate: '2025-02-01',
      subject: 'Second subject.',
      billXml: '<caml:Title>A second act.</caml:Title>',
    }),
  ];
  const twoBills = () => [
    ...exportRows('In Committee Process'),
    ...secondBill(),
  ];

  it('derives no bill when a legislator change leaves the links as they were', async () => {
    await run(twoBills(), false);
    const rows = twoBills().map((row) =>
      row.table === 'LEGISLATOR_TBL' && row.district === 'SD03'
        ? withHash({ ...row, party: 'X' } as Unhashed)
        : row,
    );

    const after = await run(rows);

    expect(after).toMatchObject({ updated: 1, derived: 0 });
  });

  it('re-derives every bill when a representative is renamed in place', async () => {
    await run(twoBills(), false);
    // Representatives are keyed by seat: a new member renames the row, and
    // no timestamp says so.
    await db.representative.update({
      where: { externalId: 'rep-ad7' },
      data: { name: 'Zed Successor' },
    });

    const after = await run(twoBills());

    expect(after).toMatchObject({ updated: 0, derived: 2 });
    const votes = await db.billVote.findMany();
    expect(votes.map((v) => v.representativeId)).toEqual([null]);
  });

  it('re-derives only the bills whose votes use a changed motion', async () => {
    await run(twoBills(), false);
    const rows = twoBills().map((row) =>
      row.table === 'BILL_MOTION_TBL'
        ? withHash({ ...row, motionText: 'Do pass as amended.' } as Unhashed)
        : row,
    );

    const after = await run(rows);

    expect(after).toMatchObject({ updated: 1, derived: 1 });
    const [vote] = await db.billVote.findMany();
    expect(vote.motionText).toBe('Do pass as amended.');
  });

  it('keeps the bills it derived and retries the one that failed', async () => {
    type DeriveBill = (...a: unknown[]) => Promise<void>;
    const target = sync as unknown as { deriveBill: DeriveBill };
    const original = target.deriveBill.bind(sync);
    const deriveBill = jest
      .spyOn(target, 'deriveBill')
      .mockImplementation(async (...args: unknown[]) => {
        const pb = args[1] as { externalId: string };
        if (pb.externalId === '202520260AB9001') throw new Error('boom');
        return original(...args);
      });

    const first = await run(twoBills(), false);
    expect(first).toMatchObject({ derived: 1, deriveFailed: 1 });
    deriveBill.mockRestore();
    const mirrored = await db.pubinfoBill.findMany({
      orderBy: { externalId: 'asc' },
      select: { externalId: true, derivedAt: true },
    });
    expect(mirrored.map((b) => b.derivedAt !== null)).toEqual([false, true]);

    // Nothing in the export changed, yet the failed bill is derived again.
    const again = await run(twoBills());

    expect(again).toMatchObject({ updated: 0, derived: 1 });
  });

  it("does not credit a predecessor's vote to the seat's current member (D15)", async () => {
    const rows = [
      ...exportRows('In Committee Process'),
      // AD07's earlier member, who left mid-session; Ada Example holds it now.
      withHash({
        table: 'LEGISLATOR_TBL',
        externalId: `${SESSION}:AD07:A:Former`,
        district: 'AD07',
        sessionYear: SESSION,
        legislatorName: 'Former, Cal',
        houseType: 'A',
        authorName: 'Former',
        lastName: 'Former',
      }),
      withHash({
        table: 'BILL_DETAIL_VOTE_TBL',
        externalId: `202520260AB9001:CX25:Former:2025-04-01 10:00:00:1:7`,
        billId: '202520260AB9001',
        locationCode: 'CX25',
        legislatorName: 'Former',
        voteDateTime: '2025-04-01 10:00:00',
        voteDateSeq: 1,
        voteCode: 'NOE',
        motionId: 7,
      }),
    ];

    await run(rows, false);

    const ada = await db.representative.findUniqueOrThrow({
      where: { externalId: 'rep-ad7' },
    });
    const votes = await db.billVote.findMany({
      orderBy: { representativeName: 'asc' },
    });
    expect(
      votes.map((v) => [v.representativeName, v.representativeId]),
    ).toEqual([
      ['Example', ada.id],
      ['Former', null],
    ]);
  });

  describe('committee referrals from hearings (D13/D20)', () => {
    it('refers a bill to each committee it was heard in, once', async () => {
      // An Assembly committee the member pages already gave us; the Senate
      // one exists only in the export.
      const assembly = await db.legislativeCommittee.create({
        data: {
          externalId: 'assembly:appropriations',
          name: 'Appropriations',
          chamber: 'Assembly',
        },
      });

      await run(exportRows('In Committee Process'), false);

      const senate = await db.legislativeCommittee.findUniqueOrThrow({
        where: { externalId: 'senate:appropriations' },
      });
      expect(senate.chamber).toBe('Senate');
      const bill = await db.bill.findUniqueOrThrow({
        where: { externalId: '202520260AB9001' },
        include: { committeeReferrals: true },
      });
      expect(
        bill.committeeReferrals.map((a) => a.legislativeCommitteeId).sort(),
      ).toEqual([assembly.id, senate.id].sort());
      expect(bill.committeeReferrals.every((a) => !a.referredAt)).toBe(true);
    });

    it('re-derives only the bill a new hearing belongs to', async () => {
      await run(twoBills(), false);
      const rows = [
        ...twoBills(),
        withHash({
          table: 'COMMITTEE_HEARING_TBL',
          externalId: '202520260AB9002:CX25:2025-05-01:2025-05-01 09:00:00',
          billId: '202520260AB9002',
          committeeType: 'CX',
          committeeNr: 25,
          hearingDate: '2025-05-01',
          locationCode: 'CX25',
          transUpdateDate: '2025-05-01 09:00:00',
        }),
      ];

      const after = await run(rows);

      expect(after).toMatchObject({ created: 1, derived: 1 });
      const second = await db.bill.findUniqueOrThrow({
        where: { externalId: '202520260AB9002' },
        include: { committeeReferrals: { include: { committee: true } } },
      });
      expect(
        second.committeeReferrals.map((r) => r.committee.externalId),
      ).toEqual(['assembly:appropriations']);
    });

    it('keeps the name member pages gave an existing committee', async () => {
      await db.legislativeCommittee.create({
        data: {
          externalId: 'assembly:appropriations',
          name: 'Committee on Appropriations',
          chamber: 'Assembly',
        },
      });

      await run(exportRows('In Committee Process'), false);

      const committee = await db.legislativeCommittee.findUniqueOrThrow({
        where: { externalId: 'assembly:appropriations' },
      });
      expect(committee.name).toBe('Committee on Appropriations');
    });

    it('matches a committee written with "&" to one spelled "and"', async () => {
      const existing = await db.legislativeCommittee.create({
        data: {
          externalId: 'assembly:growth and impact',
          name: 'Growth and Impact',
          chamber: 'Assembly',
        },
      });
      const rows = [
        ...exportRows('In Committee Process'),
        withHash({
          table: 'LOCATION_CODE_TBL',
          externalId: `${SESSION}:CX40:`,
          sessionYear: SESSION,
          locationCode: 'CX40',
          longDescription: 'Growth, & Impact',
        }),
        withHash({
          table: 'COMMITTEE_HEARING_TBL',
          externalId: '202520260AB9001:CX40:2025-05-01:t',
          billId: '202520260AB9001',
          hearingDate: '2025-05-01',
          locationCode: 'CX40',
        }),
      ];

      await run(rows, false);

      const referred = await db.billCommitteeAssignment.findMany({
        where: { legislativeCommitteeId: existing.id },
      });
      expect(referred).toHaveLength(1);
      expect(
        await db.legislativeCommittee.count({
          where: { externalId: { startsWith: 'assembly:growth' } },
        }),
      ).toBe(1);
    });

    it("maps a code by its session: another session's CX25 is another committee", async () => {
      const LATER = '20272028';
      const rows = [
        ...exportRows('In Committee Process'),
        withHash({
          table: 'LOCATION_CODE_TBL',
          externalId: `${LATER}:CX25:`,
          sessionYear: LATER,
          locationCode: 'CX25',
          longDescription: 'Budget',
        }),
        withHash({
          table: 'BILL_TBL',
          externalId: '202720280AB1',
          sessionYear: LATER,
          measureType: 'AB',
          measureNum: 1,
          currentStatus: 'In Committee Process',
        }),
        withHash({
          table: 'COMMITTEE_HEARING_TBL',
          externalId: '202720280AB1:CX25:2027-02-01:t',
          billId: '202720280AB1',
          hearingDate: '2027-02-01',
          locationCode: 'CX25',
        }),
      ];

      await run(rows, false);

      const referrals = await db.billCommitteeAssignment.findMany({
        include: { bill: true, committee: true },
      });
      const byBill = Object.fromEntries(
        referrals
          .filter((r) => r.committee.chamber === 'Assembly')
          .map((r) => [r.bill.externalId, r.committee.externalId]),
      );
      expect(byBill).toEqual({
        '202520260AB9001': 'assembly:appropriations',
        '202720280AB1': 'assembly:budget',
      });
    });

    it('replaces a referral the page path wrote, and skips a code that is no committee', async () => {
      const legacy = await db.bill.create({
        data: {
          externalId: '202520260AB9001',
          regionId: 'california',
          billNumber: 'AB 9001',
          sessionYear: '2025-2026',
          measureTypeCode: 'AB',
          title: 'Old',
          sourceUrl: 'https://example.test/old',
        },
      });
      const stale = await db.legislativeCommittee.create({
        data: { externalId: 'assembly:old', name: 'Old', chamber: 'Assembly' },
      });
      await db.billCommitteeAssignment.create({
        data: { billId: legacy.id, legislativeCommitteeId: stale.id },
      });
      const rows = [
        ...exportRows('In Committee Process'),
        withHash({
          table: 'COMMITTEE_HEARING_TBL',
          externalId: '202520260AB9001:ZZ01:2025-05-01:t',
          billId: '202520260AB9001',
          hearingDate: '2025-05-01',
          locationCode: 'ZZ01',
        }),
      ];

      await run(rows, false);

      const referrals = await db.billCommitteeAssignment.findMany({
        where: { billId: legacy.id },
        include: { committee: true },
      });
      expect(referrals.map((r) => r.committee.externalId).sort()).toEqual([
        'assembly:appropriations',
        'senate:appropriations',
      ]);
    });
  });
});
