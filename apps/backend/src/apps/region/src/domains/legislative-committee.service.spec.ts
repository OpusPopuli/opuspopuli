/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { LegislativeCommitteeService } from './legislative-committee.service';

describe('LegislativeCommitteeService', () => {
  async function buildService(
    opts: {
      committees?: any[];
      detail?: any;
      meetings?: any[];
      withDb?: boolean;
    } = {},
  ) {
    const {
      committees = [],
      detail = null,
      meetings = [],
      withDb = true,
    } = opts;

    const findManyCommittees = jest.fn(async (args: any) => {
      const filtered = args.where?.chamber
        ? committees.filter((c) => c.chamber === args.where.chamber)
        : committees;
      const sorted = [...filtered].sort((a, b) => {
        const c = a.chamber.localeCompare(b.chamber);
        return c !== 0 ? c : a.name.localeCompare(b.name);
      });
      const skip = args.skip ?? 0;
      const take = args.take ?? sorted.length;
      return sorted.slice(skip, skip + take);
    });
    const countCommittees = jest.fn(async (args: any) => {
      return args.where?.chamber
        ? committees.filter((c) => c.chamber === args.where.chamber).length
        : committees.length;
    });
    const findFirstCommittee = jest.fn(async (args: any) =>
      detail && detail.id === args.where.id ? detail : null,
    );
    const findManyMeetings = jest.fn(async () => meetings);

    const mockDb = {
      legislativeCommittee: {
        findMany: findManyCommittees,
        count: countCommittees,
        findFirst: findFirstCommittee,
      },
      meeting: { findMany: findManyMeetings },
    } as unknown as DbService;

    const providers: unknown[] = [LegislativeCommitteeService];
    if (withDb) providers.push({ provide: DbService, useValue: mockDb });

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(LegislativeCommitteeService),
      mocks: {
        findManyCommittees,
        countCommittees,
        findFirstCommittee,
        findManyMeetings,
      },
    };
  }

  describe('list', () => {
    it('returns empty result when db is unavailable', async () => {
      const built = await buildService({ withDb: false });
      const out = await built.service.list({ skip: 0, take: 10 });
      expect(out).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('returns paginated items with member counts', async () => {
      const committees = [
        {
          id: 'c1',
          externalId: 'assembly:budget',
          name: 'Budget',
          chamber: 'Assembly',
          url: null,
          description: null,
          _count: { assignments: 12 },
        },
        {
          id: 'c2',
          externalId: 'senate:health',
          name: 'Health',
          chamber: 'Senate',
          url: null,
          description: null,
          _count: { assignments: 8 },
        },
      ];
      const built = await buildService({ committees });

      const out = await built.service.list({ skip: 0, take: 10 });

      expect(out.total).toBe(2);
      expect(out.hasMore).toBe(false);
      expect(out.items[0]).toMatchObject({ name: 'Budget', memberCount: 12 });
      expect(out.items[1]).toMatchObject({ name: 'Health', memberCount: 8 });
    });

    it('honors the chamber filter', async () => {
      const committees = [
        {
          id: 'c1',
          externalId: 'assembly:budget',
          name: 'Budget',
          chamber: 'Assembly',
          url: null,
          description: null,
          _count: { assignments: 1 },
        },
        {
          id: 'c2',
          externalId: 'senate:health',
          name: 'Health',
          chamber: 'Senate',
          url: null,
          description: null,
          _count: { assignments: 1 },
        },
      ];
      const built = await buildService({ committees });

      const out = await built.service.list({
        skip: 0,
        take: 10,
        chamber: 'Senate',
      });

      expect(out.total).toBe(1);
      expect(out.items[0].chamber).toBe('Senate');
    });

    it('reports hasMore=true when more items exist than page size', async () => {
      const committees = Array.from({ length: 11 }, (_, i) => ({
        id: `c${i}`,
        externalId: `assembly:c${i}`,
        name: `C${String(i).padStart(2, '0')}`,
        chamber: 'Assembly',
        url: null,
        description: null,
        _count: { assignments: 0 },
      }));
      const built = await buildService({ committees });

      const out = await built.service.list({ skip: 0, take: 10 });

      expect(out.total).toBe(11);
      expect(out.hasMore).toBe(true);
      expect(out.items).toHaveLength(10);
    });
  });

  describe('getDetail', () => {
    it('returns null when db is unavailable', async () => {
      const built = await buildService({ withDb: false });
      const out = await built.service.getDetail('any');
      expect(out).toBeNull();
    });

    it('returns null when the committee does not exist', async () => {
      const built = await buildService({ detail: null });
      const out = await built.service.getDetail('missing');
      expect(out).toBeNull();
    });

    it('sorts members Chair → Vice Chair → Member → other, then by lastName', async () => {
      const detail = {
        id: 'c1',
        externalId: 'assembly:health',
        name: 'Health',
        chamber: 'Assembly',
        url: null,
        description: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        assignments: [
          {
            role: 'Member',
            representative: {
              id: 'r-zoe',
              name: 'Zoe Z',
              lastName: 'Z',
              party: 'D',
              photoUrl: null,
            },
          },
          {
            role: 'Chair',
            representative: {
              id: 'r-chair',
              name: 'Chair Person',
              lastName: 'Person',
              party: 'D',
              photoUrl: null,
            },
          },
          {
            role: 'Member',
            representative: {
              id: 'r-anne',
              name: 'Anne A',
              lastName: 'A',
              party: 'D',
              photoUrl: null,
            },
          },
          {
            role: 'Vice Chair',
            representative: {
              id: 'r-vc',
              name: 'Vice C',
              lastName: 'Cee',
              party: 'D',
              photoUrl: null,
            },
          },
        ],
      };
      const built = await buildService({ detail });

      const out = await built.service.getDetail('c1');

      expect(out!.members.map((m) => m.representativeId)).toEqual([
        'r-chair',
        'r-vc',
        'r-anne',
        'r-zoe',
      ]);
      expect(out!.memberCount).toBe(4);
    });

    it('includes fuzzy-matched recent hearings from the same chamber', async () => {
      const detail = {
        id: 'c1',
        externalId: 'assembly:health',
        name: 'Health',
        chamber: 'Assembly',
        url: null,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
      };
      const meetings = [
        {
          id: 'm1',
          title: 'Health Committee — Regular Session',
          scheduledAt: new Date('2026-04-15'),
          agendaUrl: 'https://example.com/m1',
        },
      ];

      const built = await buildService({ detail, meetings });

      const out = await built.service.getDetail('c1');

      expect(out!.hearings).toHaveLength(1);
      expect(out!.hearings[0].title).toContain('Health');

      // Verify the fuzzy match used the right scope
      const calls = built.mocks.findManyMeetings.mock.calls as unknown[][];
      const meetingArgs = calls[0][0] as any;
      expect(meetingArgs.where.body).toBe('Assembly');
      expect(meetingArgs.where.title.contains).toBe('Health');
      expect(meetingArgs.where.title.mode).toBe('insensitive');
    });

    it('returns empty hearings array when no meetings match', async () => {
      const detail = {
        id: 'c1',
        externalId: 'senate:obscure',
        name: 'Obscure',
        chamber: 'Senate',
        url: null,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
      };
      const built = await buildService({ detail, meetings: [] });

      const out = await built.service.getDetail('c1');

      expect(out!.hearings).toEqual([]);
    });

    it('dedupes meetings on (title, scheduledAt) and prefers absolute URLs', async () => {
      // Mirrors the real Assembly scrape bug: same hearing scraped 4× with
      // mixed relative + absolute agendaUrl values.
      const detail = {
        id: 'c1',
        externalId: 'assembly:health',
        name: 'Health',
        chamber: 'Assembly',
        url: null,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
      };
      const sharedDate = new Date('2026-05-11');
      const meetings = [
        {
          id: 'm1',
          title: 'Budget Subcommittee No. 1 On Health',
          scheduledAt: sharedDate,
          agendaUrl: '/api/dailyfile/agenda/18995',
        },
        {
          id: 'm2',
          title: 'Budget Subcommittee No. 1 On Health',
          scheduledAt: sharedDate,
          agendaUrl: '/api/dailyfile/agenda/18995',
        },
        {
          id: 'm3',
          title: 'Budget Subcommittee No. 1 On Health',
          scheduledAt: sharedDate,
          agendaUrl: 'https://www.assembly.ca.gov/api/dailyfile/agenda/18995',
        },
      ];

      const built = await buildService({ detail, meetings });

      const out = await built.service.getDetail('c1');

      expect(out!.hearings).toHaveLength(1);
      // Absolute URL wins the tiebreak so the Agenda link is clickable.
      expect(out!.hearings[0].agendaUrl).toBe(
        'https://www.assembly.ca.gov/api/dailyfile/agenda/18995',
      );
    });

    it('strips relative agendaUrls so the frontend hides the Agenda link', async () => {
      const detail = {
        id: 'c1',
        externalId: 'assembly:health',
        name: 'Health',
        chamber: 'Assembly',
        url: null,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
      };
      const meetings = [
        {
          id: 'm1',
          title: 'Health Committee — Regular Session',
          scheduledAt: new Date('2026-04-15'),
          agendaUrl: '/api/dailyfile/agenda/19000',
        },
      ];

      const built = await buildService({ detail, meetings });

      const out = await built.service.getDetail('c1');

      expect(out!.hearings).toHaveLength(1);
      expect(out!.hearings[0].agendaUrl).toBeNull();
    });
  });
});
