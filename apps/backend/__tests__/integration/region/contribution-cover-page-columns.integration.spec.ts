/**
 * Schema-shape integration tests for the #980 cover-page join columns.
 *
 * `RCPT_CD` / `EXPN_CD` line items carry no filer id — the recipient (or
 * spender) is only reachable by joining `FILING_ID` to the campaign-disclosure
 * cover page. So `contributions` / `expenditures` gain a nullable `filing_id`,
 * and `committee_id` relaxes to nullable because the linker stamps it
 * post-sync (the same shape #955 gave `independent_expenditures`).
 *
 * These assertions run against the REAL `postgres_test` schema (gated by
 * `assertTestDatabase()` inside `cleanDatabase`) rather than a mock, because
 * the thing under test IS the migration. Two failure modes in particular are
 * invisible to unit tests:
 *
 *  1. The migration not being applied at all — a mocked Prisma client happily
 *     accepts `filingId` whether or not the column exists.
 *  2. The foreign key silently changing semantics. Prisma defaults an OPTIONAL
 *     relation to `onDelete: SetNull`; had the schema omitted the explicit
 *     `onDelete: Restrict`, relaxing NOT NULL would also have converted the FK,
 *     so deleting a committee would silently orphan its finance rows to NULL —
 *     which is exactly the state the linker treats as "unresolved, please
 *     stamp". That would turn a delete into silent data corruption.
 *
 * See opuspopuli#980 (subtask 3).
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { RegionQueryService } from '../../../src/apps/region/src/domains/region-query.service';
import type { RegionCacheService } from '../../../src/apps/region/src/domains/region-cache.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

interface ColumnMeta {
  column_name: string;
  is_nullable: 'YES' | 'NO';
  data_type: string;
  character_maximum_length: number | null;
}

const FINANCE_TABLES = ['contributions', 'expenditures'] as const;

describe('#980 cover-page join columns', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const describeColumn = async (
    table: string,
    column: string,
  ): Promise<ColumnMeta | undefined> => {
    const rows = await db.$queryRaw<ColumnMeta[]>`
      SELECT column_name, is_nullable, data_type, character_maximum_length
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ${table}
         AND column_name = ${column}`;
    return rows[0];
  };

  describe.each(FINANCE_TABLES)('%s', (table) => {
    it('has a nullable filing_id of VARCHAR(50)', async () => {
      const column = await describeColumn(table, 'filing_id');

      expect(column).toBeDefined();
      expect(column?.is_nullable).toBe('YES');
      expect(column?.data_type).toBe('character varying');
      expect(column?.character_maximum_length).toBe(50);
    });

    it('has relaxed committee_id to nullable', async () => {
      const column = await describeColumn(table, 'committee_id');

      expect(column?.is_nullable).toBe('YES');
    });

    it('indexes filing_id so the linker can look rows up by cover page', async () => {
      const indexes = await db.$queryRaw<
        Array<{ indexname: string; indexdef: string }>
      >`SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = ${table}`;

      const index = indexes.find(
        (i) => i.indexname === `${table}_filing_id_idx`,
      );
      // Assert the definition, not just the name — an index of the right name
      // over the wrong column would otherwise pass. Written to still hold if
      // this later becomes a partial index.
      expect(index?.indexdef).toContain('(filing_id)');
    });
  });

  it('accepts a contribution with no committee — the pre-link shape', async () => {
    const contribution = await db.contribution.create({
      data: {
        externalId: '1234567:0:1:ABC123',
        filingId: '1234567',
        committeeId: null,
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount: '250.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    expect(contribution.committeeId).toBeNull();
    expect(contribution.filingId).toBe('1234567');
  });

  it('accepts an expenditure with no committee — the pre-link shape', async () => {
    const expenditure = await db.expenditure.create({
      data: {
        externalId: '7654321:0:1:XYZ789',
        filingId: '7654321',
        committeeId: null,
        payeeName: 'Some Print Shop',
        amount: '1000.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    expect(expenditure.committeeId).toBeNull();
    expect(expenditure.filingId).toBe('7654321');
  });

  it('still RESTRICTs deleting a committee that has contributions', async () => {
    const committee = await db.committee.create({
      data: {
        externalId: 'FILER-980-A',
        name: 'Committee to Elect Someone',
        type: 'candidate',
        sourceSystem: 'cal_access',
      },
    });
    await db.contribution.create({
      data: {
        externalId: '1111111:0:1:AAA',
        filingId: '1111111',
        committeeId: committee.id,
        donorName: 'Jane Q. Public',
        donorType: 'individual',
        amount: '250.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    // If the FK had degraded to SET NULL, this would succeed and quietly
    // reset committee_id — indistinguishable from an unlinked row.
    await expect(
      db.committee.delete({ where: { id: committee.id } }),
    ).rejects.toThrow();

    const survivor = await db.contribution.findUnique({
      where: { externalId: '1111111:0:1:AAA' },
    });
    expect(survivor?.committeeId).toBe(committee.id);
  });

  describe('query filters, against real rows', () => {
    // getContributions/getExpenditures touch no cache path, so a bare stub is
    // enough. The DB itself is real — that is the point of these two cases.
    const service = () =>
      new RegionQueryService(db, {} as unknown as RegionCacheService);

    const seedPair = async () => {
      const committee = await db.committee.create({
        data: {
          externalId: 'FILER-980-C',
          name: 'Attributed Committee',
          type: 'candidate',
          sourceSystem: 'cal_access',
        },
      });
      await db.contribution.createMany({
        data: [
          {
            externalId: '3333333:0:1:CCC',
            filingId: '3333333',
            committeeId: committee.id,
            donorName: 'Attributed Donor',
            donorType: 'individual',
            amount: '100.00',
            date: new Date('2026-03-01'),
            sourceSystem: 'cal_access',
          },
          {
            externalId: '4444444:0:1:DDD',
            filingId: '4444444',
            committeeId: null,
            donorName: 'Unattributed Donor',
            donorType: 'individual',
            amount: '999.00',
            date: new Date('2026-03-02'), // newer, so it would sort FIRST
            sourceSystem: 'cal_access',
          },
        ],
      });
      await db.expenditure.createMany({
        data: [
          {
            externalId: '5555555:0:1:EEE',
            filingId: '5555555',
            committeeId: committee.id,
            payeeName: 'Attributed Payee',
            amount: '100.00',
            date: new Date('2026-03-01'),
            sourceSystem: 'cal_access',
          },
          {
            externalId: '6666666:0:1:FFF',
            filingId: '6666666',
            committeeId: null,
            payeeName: 'Unattributed Payee',
            amount: '999.00',
            date: new Date('2026-03-02'),
            sourceSystem: 'cal_access',
          },
        ],
      });
    };

    it('omits unattributed contributions from list results and total', async () => {
      await seedPair();

      const page = await service().getContributions();

      // The unattributed row is both newer and larger, so it would lead the
      // `date desc, amount desc` ordering if the filter regressed.
      expect(page.items.map((i) => i.donorName)).toEqual(['Attributed Donor']);
      expect(page.total).toBe(1);
    });

    it('omits unattributed expenditures from list results and total', async () => {
      await seedPair();

      const page = await service().getExpenditures();

      expect(page.items.map((i) => i.payeeName)).toEqual(['Attributed Payee']);
      expect(page.total).toBe(1);
    });

    it('treats an unattributed row as not-found when fetched by id', async () => {
      await seedPair();
      const unattributed = await db.contribution.findUniqueOrThrow({
        where: { externalId: '4444444:0:1:DDD' },
      });

      // The GraphQL field is non-null, so surfacing this row would throw
      // "Cannot return null for non-nullable field" rather than fail closed.
      expect(await service().getContribution(unattributed.id)).toBeNull();
    });
  });

  it('still RESTRICTs deleting a committee that has expenditures', async () => {
    const committee = await db.committee.create({
      data: {
        externalId: 'FILER-980-B',
        name: 'Another Committee',
        type: 'pac',
        sourceSystem: 'cal_access',
      },
    });
    await db.expenditure.create({
      data: {
        externalId: '2222222:0:1:BBB',
        filingId: '2222222',
        committeeId: committee.id,
        payeeName: 'Some Print Shop',
        amount: '1000.00',
        date: new Date('2026-03-01'),
        sourceSystem: 'cal_access',
      },
    });

    await expect(
      db.committee.delete({ where: { id: committee.id } }),
    ).rejects.toThrow();

    const survivor = await db.expenditure.findUnique({
      where: { externalId: '2222222:0:1:BBB' },
    });
    expect(survivor?.committeeId).toBe(committee.id);
  });
});
