/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';

interface PropRow {
  id: string;
  externalId: string;
  title: string;
  electionDate: Date | null;
}

interface ContribRow {
  externalId: string;
  committeeId: string;
}

interface ExpRow {
  id: string;
  externalId: string;
  committeeId: string;
  propositionTitle: string | null;
  propositionId: string | null;
  supportOrOppose: string | null;
}

interface IeRow {
  id: string;
  externalId: string;
  committeeId: string;
  propositionTitle: string | null;
  propositionId: string | null;
  supportOrOppose: string | null;
}

interface Cvr2Row {
  filingId: string;
  ballotName: string | null;
  ballotNumber: string | null;
  supportOrOppose: string | null;
}

/**
 * Mock for db.expenditure.findMany. The linker calls it three ways:
 *   1) buildFilingToCommitteeIndex — no `where` filter, selects externalId/committeeId
 *   2) linkExpenditures — `where: { propositionId: null, propositionTitle: { not: null } }`
 *   3) upsertInferredPositions — `where: { propositionId: { not: null } }`, distinct + select
 * Discriminate by `args.distinct` (only branch 3 sets it) and by whether
 * propositionTitle is in the where clause.
 */
function expenditureFindMany(args: any, rows: ExpRow[]): unknown[] {
  if (args?.distinct) {
    return rows
      .filter((e) => e.propositionId !== null)
      .map((e) => ({
        committeeId: e.committeeId,
        propositionId: e.propositionId!,
        supportOrOppose: e.supportOrOppose,
      }));
  }
  if (args?.where?.propositionTitle !== undefined) {
    return rows
      .filter((e) => e.propositionId === null && e.propositionTitle)
      .map((e) => ({ id: e.id, propositionTitle: e.propositionTitle }));
  }
  return rows.map((e) => ({
    externalId: e.externalId,
    committeeId: e.committeeId,
  }));
}

/** Same shape as expenditureFindMany but for IndependentExpenditure rows. */
function ieFindMany(args: any, rows: IeRow[]): unknown[] {
  if (args?.distinct) {
    return rows
      .filter((ie) => ie.propositionId !== null)
      .map((ie) => ({
        committeeId: ie.committeeId,
        propositionId: ie.propositionId!,
        supportOrOppose: ie.supportOrOppose,
      }));
  }
  if (args?.where?.propositionTitle !== undefined) {
    return rows
      .filter((ie) => ie.propositionId === null && ie.propositionTitle)
      .map((ie) => ({ id: ie.id, propositionTitle: ie.propositionTitle }));
  }
  return rows;
}

describe('PropositionFinanceLinkerService', () => {
  /**
   * Build a service with mocked DB. The mock holds in-memory tables that
   * mirror the relevant Prisma model methods used by the linker. Tests
   * mutate the table contents to set up scenarios; the service reads
   * through the mock as it would in production.
   */
  async function buildService(
    opts: {
      propositions?: PropRow[];
      contributions?: ContribRow[];
      expenditures?: ExpRow[];
      independentExpenditures?: IeRow[];
      cvr2Filings?: Cvr2Row[];
      configValues?: Record<string, string | undefined>;
      withDb?: boolean;
    } = {},
  ) {
    const {
      propositions = [],
      contributions = [],
      expenditures = [],
      independentExpenditures = [],
      cvr2Filings = [],
      configValues = {},
      withDb = true,
    } = opts;

    const positionsTable: Array<{
      committeeId: string;
      propositionId: string;
      position: 'support' | 'oppose';
      isPrimaryFormation: boolean;
      sourceFiling: string | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const expRows = [...expenditures];
    const ieRows = [...independentExpenditures];

    const upsertPosition = jest.fn(async (args: any) => {
      const key = args.where.committeeId_propositionId_position;
      const existing = positionsTable.find(
        (p) =>
          p.committeeId === key.committeeId &&
          p.propositionId === key.propositionId &&
          p.position === key.position,
      );
      if (existing) {
        const update = args.update ?? {};
        if (update.isPrimaryFormation !== undefined) {
          existing.isPrimaryFormation = update.isPrimaryFormation;
        }
        if (update.sourceFiling !== undefined) {
          existing.sourceFiling = update.sourceFiling;
        }
        existing.updatedAt = new Date(existing.updatedAt.getTime() + 1);
        return { createdAt: existing.createdAt, updatedAt: existing.updatedAt };
      }
      const now = new Date();
      const row = {
        committeeId: args.create.committeeId,
        propositionId: args.create.propositionId,
        position: args.create.position,
        isPrimaryFormation: args.create.isPrimaryFormation,
        sourceFiling: args.create.sourceFiling,
        createdAt: now,
        updatedAt: now,
      };
      positionsTable.push(row);
      return { createdAt: now, updatedAt: now };
    });

    const mockDb = {
      proposition: {
        findMany: jest.fn(async (args?: any) => {
          // Honor the electionDate window so the cutoff test exercises
          // the real filter path. The linker passes:
          //   where: { OR: [{ electionDate: null }, { electionDate: { gte: cutoff } }] }
          const cutoff: Date | undefined =
            args?.where?.OR?.[1]?.electionDate?.gte;
          return propositions
            .filter(
              (p) =>
                !cutoff || p.electionDate === null || p.electionDate >= cutoff,
            )
            .map((p) => ({
              id: p.id,
              externalId: p.externalId,
              title: p.title,
              electionDate: p.electionDate,
            }));
        }),
      },
      contribution: {
        findMany: jest.fn(async () =>
          contributions.map((c) => ({
            externalId: c.externalId,
            committeeId: c.committeeId,
          })),
        ),
      },
      expenditure: {
        findMany: jest.fn(async (args?: any) =>
          expenditureFindMany(args, expRows),
        ),
        update: jest.fn(async (args: any) => {
          const row = expRows.find((e) => e.id === args.where.id);
          if (row) {
            row.propositionId = args.data.propositionId ?? null;
          }
          return row ?? null;
        }),
      },
      independentExpenditure: {
        findMany: jest.fn(async (args?: any) => ieFindMany(args, ieRows)),
        update: jest.fn(async (args: any) => {
          const row = ieRows.find((ie) => ie.id === args.where.id);
          if (row) {
            row.propositionId = args.data.propositionId ?? null;
          }
          return row ?? null;
        }),
      },
      cvr2Filing: {
        findMany: jest.fn(async () => cvr2Filings),
      },
      committeeMeasurePosition: {
        upsert: upsertPosition,
      },
    } as unknown as DbService;

    const mockConfig = {
      get: jest.fn((k: string) => configValues[k]),
    } as unknown as ConfigService;

    const providers: unknown[] = [PropositionFinanceLinkerService];
    providers.push({ provide: ConfigService, useValue: mockConfig });
    if (withDb) providers.push({ provide: DbService, useValue: mockDb });

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(PropositionFinanceLinkerService),
      positionsTable,
      expRows,
      ieRows,
      mockDb,
      upsertPosition,
    };
  }

  describe('when db is unavailable', () => {
    it('returns zeroed counts and does no work', async () => {
      const built = await buildService({ withDb: false });
      const result = await built.service.linkAll();
      expect(result).toEqual({
        cvr2Resolved: 0,
        cvr2Skipped: 0,
        expenditureLinked: 0,
        independentExpenditureLinked: 0,
        inferredPositions: 0,
      });
    });
  });

  describe('linkAll', () => {
    it('no-ops when no propositions are in the election window', async () => {
      const built = await buildService({ propositions: [] });
      const result = await built.service.linkAll();
      expect(result.cvr2Resolved).toBe(0);
      expect(result.expenditureLinked).toBe(0);
      expect(built.upsertPosition).not.toHaveBeenCalled();
    });

    it('writes a primary-formation position when CVR2 resolves both filing and ballot', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        contributions: [
          // FILING_ID 12345 → committeeId C-A
          { externalId: '12345:1', committeeId: 'committee-A' },
        ],
        cvr2Filings: [
          {
            filingId: '12345',
            ballotName: 'Voting thresholds',
            ballotNumber: 'ACA 13',
            supportOrOppose: 'S',
          },
        ],
      });

      await built.service.linkAll();

      const primary = built.positionsTable.find(
        (p) => p.isPrimaryFormation === true,
      );
      expect(primary).toBeDefined();
      expect(primary?.committeeId).toBe('committee-A');
      expect(primary?.propositionId).toBe('prop-1');
      expect(primary?.position).toBe('support');
      expect(primary?.sourceFiling).toBe('12345');
    });

    it('skips CVR2 rows whose filing or ballot cannot be resolved', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        contributions: [],
        cvr2Filings: [
          {
            filingId: '99999', // no committee for this filing
            ballotName: 'Voting thresholds',
            ballotNumber: 'ACA 13',
            supportOrOppose: 'S',
          },
          {
            filingId: '12345',
            ballotName: 'A measure not in our DB',
            ballotNumber: null,
            supportOrOppose: 'S',
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.cvr2Resolved).toBe(0);
      expect(result.cvr2Skipped).toBe(2);
      expect(built.positionsTable).toHaveLength(0);
    });

    it('infers a non-primary position from a linked expenditure', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        expenditures: [
          {
            id: 'exp-1',
            externalId: '88888:1',
            committeeId: 'committee-X',
            propositionTitle: 'Voting thresholds',
            propositionId: null,
            supportOrOppose: 'oppose',
          },
        ],
      });

      const result = await built.service.linkAll();

      // Expenditure FK is populated via fuzzy title match
      expect(result.expenditureLinked).toBe(1);
      expect(built.expRows[0].propositionId).toBe('prop-1');

      // And an inferred position row was upserted
      const inferred = built.positionsTable.find(
        (p) => p.isPrimaryFormation === false,
      );
      expect(inferred).toBeDefined();
      expect(inferred?.committeeId).toBe('committee-X');
      expect(inferred?.position).toBe('oppose');
    });

    it('infers a non-primary position from a linked independent expenditure', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'SCA 1',
            title: 'Recall election reform',
            electionDate: new Date(),
          },
        ],
        independentExpenditures: [
          {
            id: 'ie-1',
            externalId: '77777:1',
            committeeId: 'committee-Y',
            propositionTitle: 'Recall election reform',
            propositionId: null,
            supportOrOppose: 'support',
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.independentExpenditureLinked).toBe(1);
      expect(built.ieRows[0].propositionId).toBe('prop-1');
      expect(
        built.positionsTable.find(
          (p) => p.committeeId === 'committee-Y' && p.position === 'support',
        ),
      ).toBeDefined();
    });

    it('does not downgrade a CVR2 primary-formation row when an inferred row tries to overwrite', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        contributions: [{ externalId: '12345:1', committeeId: 'committee-A' }],
        cvr2Filings: [
          {
            filingId: '12345',
            ballotName: 'Voting thresholds',
            ballotNumber: 'ACA 13',
            supportOrOppose: 'S',
          },
        ],
        // Same committee+prop with same position from an expenditure — would
        // create the same key with isPrimaryFormation=false.
        expenditures: [
          {
            id: 'exp-1',
            externalId: '12345:2',
            committeeId: 'committee-A',
            propositionTitle: 'Voting thresholds',
            propositionId: null,
            supportOrOppose: 'support',
          },
        ],
      });

      await built.service.linkAll();

      const row = built.positionsTable.find(
        (p) => p.committeeId === 'committee-A' && p.position === 'support',
      );
      expect(row).toBeDefined();
      // Started as primary, must remain primary even after the inferred upsert.
      expect(row!.isPrimaryFormation).toBe(true);
    });

    it('idempotent: re-running over the same data does not create duplicates', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        contributions: [{ externalId: '12345:1', committeeId: 'committee-A' }],
        cvr2Filings: [
          {
            filingId: '12345',
            ballotName: 'Voting thresholds',
            ballotNumber: 'ACA 13',
            supportOrOppose: 'S',
          },
        ],
      });

      await built.service.linkAll();
      await built.service.linkAll();

      // Only one (committee, proposition, position) row exists
      const rowsForKey = built.positionsTable.filter(
        (p) =>
          p.committeeId === 'committee-A' &&
          p.propositionId === 'prop-1' &&
          p.position === 'support',
      );
      expect(rowsForKey).toHaveLength(1);
    });

    it('skips CVR2 rows with unrecognized supportOrOppose codes', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        contributions: [{ externalId: '12345:1', committeeId: 'committee-A' }],
        cvr2Filings: [
          {
            filingId: '12345',
            ballotName: 'Voting thresholds',
            ballotNumber: 'ACA 13',
            supportOrOppose: '???', // garbage code
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.cvr2Resolved).toBe(0);
      expect(result.cvr2Skipped).toBe(1);
    });

    it('honors FINANCE_LINKER_ELECTION_WINDOW_YEARS to exclude old propositions', async () => {
      const ancient = new Date();
      ancient.setFullYear(ancient.getFullYear() - 10);
      const built = await buildService({
        configValues: { FINANCE_LINKER_ELECTION_WINDOW_YEARS: '1' },
        propositions: [
          {
            id: 'prop-old',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: ancient,
          },
        ],
        contributions: [{ externalId: '12345:1', committeeId: 'committee-A' }],
        cvr2Filings: [
          {
            filingId: '12345',
            ballotName: 'Voting thresholds',
            ballotNumber: 'ACA 13',
            supportOrOppose: 'S',
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.cvr2Resolved).toBe(0);
      expect(built.positionsTable).toHaveLength(0);
    });
  });

  describe('fuzzy title resolution', () => {
    it('matches via the externalId alias even when the user supplies just the bill number', async () => {
      const built = await buildService({
        propositions: [
          {
            id: 'prop-1',
            externalId: 'ACA 13',
            title: 'Voting thresholds',
            electionDate: new Date(),
          },
        ],
        expenditures: [
          {
            id: 'exp-1',
            externalId: '88888:1',
            committeeId: 'committee-X',
            propositionTitle: 'ACA 13', // matches via externalId, not title
            propositionId: null,
            supportOrOppose: 'support',
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.expenditureLinked).toBe(1);
      expect(built.expRows[0].propositionId).toBe('prop-1');
    });

    it('matches via leading-token prefix when title is similar but not identical', async () => {
      const built = await buildService({
        configValues: { FINANCE_LINKER_TITLE_MATCH_MIN_TOKENS: '2' },
        propositions: [
          {
            id: 'prop-1',
            externalId: 'PROP 36',
            title: 'Drug treatment expansion act',
            electionDate: new Date(),
          },
        ],
        expenditures: [
          {
            id: 'exp-1',
            externalId: '88888:1',
            committeeId: 'committee-X',
            propositionTitle: 'Drug treatment expansion of 2026 ballot', // first 2 tokens match
            propositionId: null,
            supportOrOppose: 'oppose',
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.expenditureLinked).toBe(1);
    });

    it('returns no match when token overlap is below the threshold', async () => {
      const built = await buildService({
        configValues: { FINANCE_LINKER_TITLE_MATCH_MIN_TOKENS: '3' },
        propositions: [
          {
            id: 'prop-1',
            externalId: 'PROP 36',
            title: 'Drug treatment expansion act',
            electionDate: new Date(),
          },
        ],
        expenditures: [
          {
            id: 'exp-1',
            externalId: '88888:1',
            committeeId: 'committee-X',
            propositionTitle: 'Drug pricing — totally different measure',
            propositionId: null,
            supportOrOppose: 'oppose',
          },
        ],
      });

      const result = await built.service.linkAll();
      expect(result.expenditureLinked).toBe(0);
      expect(built.expRows[0].propositionId).toBeNull();
    });
  });
});
