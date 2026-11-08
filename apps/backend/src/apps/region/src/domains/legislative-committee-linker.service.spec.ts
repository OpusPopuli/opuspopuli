/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';

interface RepRow {
  id: string;
  chamber: string;
  committees: unknown;
}

describe('LegislativeCommitteeLinkerService', () => {
  /**
   * Build a service backed by an in-memory mock DB. The mock honors the
   * pagination cursor used by linkAll() so we can also test multi-page
   * scenarios cheaply.
   */
  async function buildService(
    opts: {
      reps?: RepRow[];
      configValues?: Record<string, string | undefined>;
      withDb?: boolean;
    } = {},
  ) {
    const { reps = [], configValues = {}, withDb = true } = opts;

    const committeesTable: Array<{
      id: string;
      externalId: string;
      name: string;
      chamber: string;
    }> = [];
    const assignmentsTable: Array<{
      representativeId: string;
      legislativeCommitteeId: string;
      role: string | null;
    }> = [];

    let nextId = 1;
    const newId = () => `cmt-${nextId++}`;

    const findManyReps = jest.fn(async (args: any) => {
      const all = [...reps]; // deletedAt filter ignored for tests
      const startIdx = args.cursor
        ? all.findIndex((r) => r.id === args.cursor.id) + (args.skip ?? 0)
        : 0;
      return all.slice(startIdx, startIdx + (args.take ?? all.length));
    });

    const upsertCommittee = jest.fn(async (args: any) => {
      const existing = committeesTable.find(
        (c) => c.externalId === args.where.externalId,
      );
      if (existing) {
        existing.name = args.update.name ?? existing.name;
        existing.chamber = args.update.chamber ?? existing.chamber;
        return { id: existing.id };
      }
      const row = {
        id: newId(),
        externalId: args.create.externalId,
        name: args.create.name,
        chamber: args.create.chamber,
      };
      committeesTable.push(row);
      return { id: row.id };
    });

    const upsertAssignment = jest.fn(async (args: any) => {
      const key = args.where.representativeId_legislativeCommitteeId;
      const existing = assignmentsTable.find(
        (a) =>
          a.representativeId === key.representativeId &&
          a.legislativeCommitteeId === key.legislativeCommitteeId,
      );
      if (existing) {
        existing.role = args.update.role ?? existing.role;
        return existing;
      }
      const row = {
        representativeId: args.create.representativeId,
        legislativeCommitteeId: args.create.legislativeCommitteeId,
        role: args.create.role ?? null,
      };
      assignmentsTable.push(row);
      return row;
    });

    const mockDb = {
      representative: { findMany: findManyReps },
      legislativeCommittee: { upsert: upsertCommittee },
      representativeCommitteeAssignment: { upsert: upsertAssignment },
    } as unknown as DbService;

    const mockConfig = {
      get: jest.fn((k: string) => configValues[k]),
    } as unknown as ConfigService;

    const providers: unknown[] = [LegislativeCommitteeLinkerService];
    providers.push({ provide: ConfigService, useValue: mockConfig });
    if (withDb) providers.push({ provide: DbService, useValue: mockDb });

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(LegislativeCommitteeLinkerService),
      committeesTable,
      assignmentsTable,
      mocks: { findManyReps, upsertCommittee, upsertAssignment },
    };
  }

  describe('when db is unavailable', () => {
    it('returns zeros without throwing', async () => {
      const built = await buildService({ withDb: false });
      const result = await built.service.linkAll();
      expect(result).toEqual({
        committeesUpserted: 0,
        assignmentsUpserted: 0,
        repsScanned: 0,
        skipped: 0,
      });
    });
  });

  describe('name normalization', () => {
    it('collapses common variants to a single committee row', async () => {
      const built = await buildService({
        reps: [
          {
            id: 'r1',
            chamber: 'Assembly',
            committees: [{ name: 'Budget', role: 'Chair' }],
          },
          {
            id: 'r2',
            chamber: 'Assembly',
            committees: [{ name: 'Committee on Budget', role: 'Member' }],
          },
          {
            id: 'r3',
            chamber: 'Assembly',
            committees: [
              { name: 'Standing Committee on the Budget', role: 'Vice Chair' },
            ],
          },
          {
            id: 'r4',
            chamber: 'Assembly',
            committees: [{ name: 'Assembly Budget Committee', role: 'Member' }],
          },
        ],
      });

      const result = await built.service.linkAll();

      // All four phrasings collapse to one Assembly committee row.
      expect(built.committeesTable).toHaveLength(1);
      expect(built.committeesTable[0]).toMatchObject({
        externalId: 'assembly:budget',
        chamber: 'Assembly',
      });
      // Display name picks the longest scraped form.
      expect(built.committeesTable[0].name).toBe(
        'Standing Committee on the Budget',
      );
      // 4 reps → 4 assignments.
      expect(result.assignmentsUpserted).toBe(4);
    });

    it('keeps Assembly and Senate Health as distinct committees', async () => {
      const built = await buildService({
        reps: [
          {
            id: 'r1',
            chamber: 'Assembly',
            committees: [{ name: 'Health' }],
          },
          {
            id: 'r2',
            chamber: 'Senate',
            committees: [{ name: 'Health' }],
          },
        ],
      });

      await built.service.linkAll();

      expect(built.committeesTable).toHaveLength(2);
      const externalIds = built.committeesTable.map((c) => c.externalId).sort();
      expect(externalIds).toEqual(['assembly:health', 'senate:health']);
    });
  });

  describe('role canonicalization', () => {
    it('maps role variants to Chair / Vice Chair / Member', async () => {
      const built = await buildService({
        reps: [
          {
            id: 'r1',
            chamber: 'Assembly',
            committees: [{ name: 'X', role: 'Chair' }],
          },
          {
            id: 'r2',
            chamber: 'Assembly',
            committees: [{ name: 'Y', role: 'Vice Chair' }],
          },
          {
            id: 'r3',
            chamber: 'Assembly',
            committees: [{ name: 'Z', role: 'vice-chair' }],
          },
          {
            id: 'r4',
            chamber: 'Assembly',
            committees: [{ name: 'W', role: null }],
          },
          {
            id: 'r5',
            chamber: 'Assembly',
            committees: [{ name: 'V', role: 'Ranking Minority' }],
          },
        ],
      });

      await built.service.linkAll();

      const roles = built.assignmentsTable.map((a) => a.role).sort();
      expect(roles).toEqual([
        'Chair',
        'Member',
        'Member',
        'Vice Chair',
        'Vice Chair',
      ]);
    });
  });

  describe('idempotency', () => {
    it('produces zero new rows on a second run over unchanged data', async () => {
      const built = await buildService({
        reps: [
          {
            id: 'r1',
            chamber: 'Assembly',
            committees: [
              { name: 'Budget', role: 'Chair' },
              { name: 'Health', role: 'Member' },
            ],
          },
        ],
      });

      const first = await built.service.linkAll();
      expect(first.committeesUpserted).toBe(2);
      expect(first.assignmentsUpserted).toBe(2);

      const second = await built.service.linkAll();
      expect(built.committeesTable).toHaveLength(2);
      expect(built.assignmentsTable).toHaveLength(2);
      // Counts reflect what was processed, but the in-memory tables
      // confirm no duplicates were created.
      expect(second.repsScanned).toBe(1);
    });
  });

  describe('malformed input handling', () => {
    it('skips reps with non-array committees JSON', async () => {
      const built = await buildService({
        reps: [
          { id: 'r1', chamber: 'Assembly', committees: null },
          { id: 'r2', chamber: 'Assembly', committees: { not: 'an-array' } },
          {
            id: 'r3',
            chamber: 'Assembly',
            committees: [{ name: 'Real Committee' }],
          },
        ],
      });

      const result = await built.service.linkAll();

      expect(result.repsScanned).toBe(3);
      expect(result.skipped).toBe(2);
      expect(built.committeesTable).toHaveLength(1);
    });

    it('drops committee entries with missing or empty name', async () => {
      const built = await buildService({
        reps: [
          {
            id: 'r1',
            chamber: 'Assembly',
            committees: [
              { name: '' },
              { name: '   ' },
              { role: 'Chair' },
              { name: 'Real' },
            ],
          },
        ],
      });

      await built.service.linkAll();

      expect(built.committeesTable).toHaveLength(1);
      expect(built.committeesTable[0].externalId).toBe('assembly:real');
    });
  });

  describe('pagination', () => {
    it('walks more reps than fit in one batch', async () => {
      const reps: RepRow[] = Array.from({ length: 7 }, (_, i) => ({
        id: `r${i}`,
        chamber: 'Assembly',
        committees: [{ name: `Committee ${i}` }],
      }));

      const built = await buildService({
        reps,
        configValues: { LEGISLATIVE_COMMITTEE_LINKER_BATCH_SIZE: '3' },
      });

      await built.service.linkAll();

      // 7 reps each on their own committee → 7 distinct committees.
      expect(built.committeesTable).toHaveLength(7);
      // Multiple findMany calls because batch size is 3.
      expect(built.mocks.findManyReps.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
