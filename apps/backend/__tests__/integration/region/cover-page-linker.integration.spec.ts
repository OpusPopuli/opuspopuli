/**
 * CoverPageLinkerService integration tests (#980).
 *
 * The linker resolves the committee that FILED each contribution/expenditure by
 * joining `filing_id -> cvr_filings.filer_id -> committees.external_id`, in a
 * single set-based `UPDATE … FROM` per table. Because that join is raw SQL, a
 * mocked Prisma proves nothing about it — the unit spec covers orchestration,
 * and everything that could actually be *wrong about the join* lives here:
 * column names, the deleted-committee guard, idempotency, and the direction of
 * attribution (filer, not counterparty — the whole point of #980).
 *
 * Runs against the real `postgres_test` schema, gated by `assertTestDatabase()`
 * inside `cleanDatabase`.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { CoverPageLinkerService } from '../../../src/apps/region/src/domains/cover-page-linker.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

describe('CoverPageLinkerService (#980)', () => {
  let db: DbService;
  let linker: CoverPageLinkerService;

  beforeAll(async () => {
    db = await getDbService();
    linker = new CoverPageLinkerService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /** The filer — the committee that submitted the filing and received the money. */
  const seedFiler = async (filerId = 'FILER-1', filingId = '900001') => {
    const committee = await db.committee.create({
      data: {
        externalId: filerId,
        name: 'Committee to Elect Someone',
        type: 'candidate',
        sourceSystem: 'cal_access',
      },
    });
    await db.cvrFiling.create({
      data: {
        externalId: filingId,
        filingId,
        filerId,
        sourceSystem: 'cal_access',
      },
    });
    return committee;
  };

  const seedContribution = (filingId: string | null, externalId: string) =>
    db.contribution.create({
      data: {
        externalId,
        filingId,
        committeeId: null,
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount: '250.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

  it('attributes a contribution to the filer via the cover page', async () => {
    const filer = await seedFiler();
    await seedContribution('900001', '900001:0:1:AAA');

    const result = await linker.linkAll();

    expect(result.contributions).toMatchObject({ considered: 1, linked: 1 });
    const row = await db.contribution.findUniqueOrThrow({
      where: { externalId: '900001:0:1:AAA' },
    });
    expect(row.committeeId).toBe(filer.id);
  });

  it('attributes an expenditure to the filer via the cover page', async () => {
    const filer = await seedFiler();
    await db.expenditure.create({
      data: {
        externalId: '900001:0:2:BBB',
        filingId: '900001',
        committeeId: null,
        payeeName: 'Some Print Shop',
        amount: '1000.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    const result = await linker.linkAll();

    expect(result.expenditures).toMatchObject({ considered: 1, linked: 1 });
    const row = await db.expenditure.findUniqueOrThrow({
      where: { externalId: '900001:0:2:BBB' },
    });
    expect(row.committeeId).toBe(filer.id);
  });

  it('attributes to the filer even when a counterparty committee exists', async () => {
    // The #980 defect in miniature: RCPT_CD's CMTE_ID names the *contributor*.
    // A linker that followed it would stamp the donor's committee here.
    const filer = await seedFiler();
    const contributor = await db.committee.create({
      data: {
        externalId: 'FILER-CONTRIBUTOR',
        name: 'Some Other PAC',
        type: 'pac',
        sourceSystem: 'cal_access',
      },
    });
    await seedContribution('900001', '900001:0:1:AAA');

    await linker.linkAll();

    const row = await db.contribution.findUniqueOrThrow({
      where: { externalId: '900001:0:1:AAA' },
    });
    expect(row.committeeId).toBe(filer.id);
    expect(row.committeeId).not.toBe(contributor.id);
  });

  it('is idempotent — a second run rewrites nothing', async () => {
    const filer = await seedFiler();
    await seedContribution('900001', '900001:0:1:AAA');

    await linker.linkAll();
    const second = await linker.linkAll();

    expect(second.contributions).toMatchObject({ considered: 0, linked: 0 });
    const row = await db.contribution.findUniqueOrThrow({
      where: { externalId: '900001:0:1:AAA' },
    });
    expect(row.committeeId).toBe(filer.id);
  });

  it('never re-attributes a row that already has a committee', async () => {
    const filer = await seedFiler();
    const other = await db.committee.create({
      data: {
        externalId: 'FILER-OTHER',
        name: 'Already Linked Committee',
        type: 'pac',
        sourceSystem: 'cal_access',
      },
    });
    await db.contribution.create({
      data: {
        externalId: '900001:0:9:ZZZ',
        filingId: '900001', // cover page points at `filer`, but this row is taken
        committeeId: other.id,
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount: '250.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    await linker.linkAll();

    const row = await db.contribution.findUniqueOrThrow({
      where: { externalId: '900001:0:9:ZZZ' },
    });
    expect(row.committeeId).toBe(other.id);
    expect(row.committeeId).not.toBe(filer.id);
  });

  it('leaves a row unlinked when no cover page matches its filing', async () => {
    await seedFiler();
    await seedContribution('999999', '999999:0:1:CCC'); // no cover page

    const result = await linker.linkAll();

    expect(result.contributions).toMatchObject({
      considered: 1,
      linked: 0,
      skippedNoCoverPage: 1,
      skippedNoCommittee: 0,
    });
  });

  it('reports a cover page whose filer matches no committee', async () => {
    await db.cvrFiling.create({
      data: {
        externalId: '900002',
        filingId: '900002',
        filerId: 'FILER-UNKNOWN',
        sourceSystem: 'cal_access',
      },
    });
    await seedContribution('900002', '900002:0:1:DDD');

    const result = await linker.linkAll();

    expect(result.contributions).toMatchObject({
      considered: 1,
      linked: 0,
      skippedNoCoverPage: 0,
      skippedNoCommittee: 1,
    });
  });

  it('ignores soft-deleted committees', async () => {
    // A soft-deleted committee is not a valid attribution target; without the
    // deleted_at guard the money would be assigned to a retired row.
    await db.committee.create({
      data: {
        externalId: 'FILER-GONE',
        name: 'Dissolved Committee',
        type: 'pac',
        sourceSystem: 'cal_access',
        deletedAt: new Date('2026-01-01'),
      },
    });
    await db.cvrFiling.create({
      data: {
        externalId: '900003',
        filingId: '900003',
        filerId: 'FILER-GONE',
        sourceSystem: 'cal_access',
      },
    });
    await seedContribution('900003', '900003:0:1:EEE');

    const result = await linker.linkAll();

    expect(result.contributions.linked).toBe(0);
    const row = await db.contribution.findUniqueOrThrow({
      where: { externalId: '900003:0:1:EEE' },
    });
    expect(row.committeeId).toBeNull();
  });

  it('links many rows across filings in one pass', async () => {
    const filerA = await seedFiler('FILER-A', '900010');
    const filerB = await seedFiler('FILER-B', '900011');
    await seedContribution('900010', '900010:0:1:A1');
    await seedContribution('900010', '900010:0:2:A2');
    await seedContribution('900011', '900011:0:1:B1');
    await seedContribution(null, 'no-filing:1'); // not considered at all

    const result = await linker.linkAll();

    expect(result.contributions).toMatchObject({ considered: 3, linked: 3 });
    const rows = await db.contribution.findMany({
      select: { externalId: true, committeeId: true },
    });
    const byExternal = new Map(rows.map((r) => [r.externalId, r.committeeId]));
    expect(byExternal.get('900010:0:1:A1')).toBe(filerA.id);
    expect(byExternal.get('900010:0:2:A2')).toBe(filerA.id);
    expect(byExternal.get('900011:0:1:B1')).toBe(filerB.id);
    expect(byExternal.get('no-filing:1')).toBeNull();
  });
});
