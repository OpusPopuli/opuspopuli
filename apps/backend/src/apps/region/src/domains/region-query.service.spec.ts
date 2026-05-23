import { Test, TestingModule } from '@nestjs/testing';

import { RegionQueryService } from './region-query.service';
import { RegionCacheService } from './region-cache.service';
import { REGION_CACHE } from './region.tokens';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';

function createMockCache() {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    has: jest.fn().mockResolvedValue(false),
    delete: jest.fn().mockResolvedValue(true),
    clear: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn().mockResolvedValue([]),
    size: 0,
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('RegionQueryService — caching', () => {
  let service: RegionQueryService;
  let mockDb: MockDbClient;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockCache = createMockCache();

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.count.mockResolvedValue(0);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.meeting.count.mockResolvedValue(0);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.representative.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: mockCache },
        RegionCacheService,
        { provide: DbService, useValue: mockDb },
        RegionQueryService,
      ],
    }).compile();

    service = module.get<RegionQueryService>(RegionQueryService);
  });

  it('should return cached propositions on cache hit', async () => {
    const cachedData = {
      items: [{ id: 'cached-1', title: 'Cached Prop' }],
      total: 1,
      hasMore: false,
    };
    mockCache.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const result = await service.getPropositions(0, 10);

    expect(result).toEqual(cachedData);
    expect(mockDb.proposition.findMany).not.toHaveBeenCalled();
    expect(mockDb.proposition.count).not.toHaveBeenCalled();
  });

  it('should cache propositions on cache miss', async () => {
    mockDb.proposition.findMany.mockResolvedValueOnce([
      {
        id: 'prop-1',
        externalId: 'ext-1',
        title: 'Prop 1',
        summary: 'Sum',
        fullText: null,
        status: 'pending',
        electionDate: null,
        sourceUrl: null,
        analysisSummary: null,
        keyProvisions: null,
        fiscalImpact: null,
        yesOutcome: null,
        noOutcome: null,
        existingVsProposed: null,
        analysisSections: null,
        analysisClaims: null,
        analysisSource: null,
        analysisPromptHash: null,
        analysisGeneratedAt: null,
        deletedAt: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      },
    ]);
    mockDb.proposition.count.mockResolvedValueOnce(1);

    await service.getPropositions(0, 10);

    expect(mockCache.set).toHaveBeenCalledWith(
      'propositions:0:10',
      expect.any(String),
    );
  });

  it('should return cached meetings on cache hit', async () => {
    const cachedData = {
      items: [{ id: 'cached-m1', title: 'Cached Meeting' }],
      total: 1,
      hasMore: false,
    };
    mockCache.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const result = await service.getMeetings(0, 10);

    expect(result).toEqual(cachedData);
    expect(mockDb.meeting.findMany).not.toHaveBeenCalled();
  });

  it('should return cached representatives on cache hit', async () => {
    const cachedData = {
      items: [{ id: 'cached-r1', name: 'Cached Rep' }],
      total: 1,
      hasMore: false,
    };
    mockCache.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const result = await service.getRepresentatives(0, 10);

    expect(result).toEqual(cachedData);
    expect(mockDb.representative.findMany).not.toHaveBeenCalled();
  });

  it('should include chamber in representatives cache key', async () => {
    mockCache.get.mockResolvedValueOnce(undefined);
    mockDb.representative.findMany.mockResolvedValueOnce([]);
    mockDb.representative.count.mockResolvedValueOnce(0);

    await service.getRepresentatives(0, 10, 'Senate');

    expect(mockCache.set).toHaveBeenCalledWith(
      'representatives:0:10:Senate',
      expect.any(String),
    );
  });
});

describe('RegionQueryService — query methods', () => {
  let service: RegionQueryService;
  let mockDb: MockDbClient;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockCache = createMockCache();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: mockCache },
        RegionCacheService,
        { provide: DbService, useValue: mockDb },
        RegionQueryService,
      ],
    }).compile();

    service = module.get<RegionQueryService>(RegionQueryService);
  });

  describe('getPropositions', () => {
    it('should return paginated propositions', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'prop-1',
          title: 'Prop 1',
          summary: 'Summary',
          status: 'pending',
          fullText: null,
          electionDate: null,
          sourceUrl: null,
          analysisSummary: null,
          keyProvisions: null,
          fiscalImpact: null,
          yesOutcome: null,
          noOutcome: null,
          existingVsProposed: null,
          analysisSections: null,
          analysisClaims: null,
          analysisSource: null,
          analysisPromptHash: null,
          analysisGeneratedAt: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.proposition.findMany.mockResolvedValue(mockItems as never);
      mockDb.proposition.count.mockResolvedValue(1);

      const result = await service.getPropositions(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        externalId: `prop-${i}`,
        title: `Prop ${i}`,
        summary: 'Summary',
        status: 'pending',
        fullText: null,
        electionDate: null,
        sourceUrl: null,
        analysisSummary: null,
        keyProvisions: null,
        fiscalImpact: null,
        yesOutcome: null,
        noOutcome: null,
        existingVsProposed: null,
        analysisSections: null,
        analysisClaims: null,
        analysisSource: null,
        analysisPromptHash: null,
        analysisGeneratedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      mockDb.proposition.findMany.mockResolvedValue(mockItems as never);
      mockDb.proposition.count.mockResolvedValue(15);

      const result = await service.getPropositions(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getProposition', () => {
    it('should return a single proposition by ID', async () => {
      const mockProp = { id: '1', title: 'Test Prop' };
      mockDb.proposition.findUnique.mockResolvedValue(mockProp as never);

      const result = await service.getProposition('1');

      expect(result).toEqual(mockProp);
      expect(mockDb.proposition.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null when not found', async () => {
      mockDb.proposition.findUnique.mockResolvedValue(null);

      const result = await service.getProposition('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getMeetings', () => {
    it('should return paginated meetings', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'meeting-1',
          title: 'Meeting 1',
          body: 'Council',
          scheduledAt: new Date(),
          location: null,
          agendaUrl: null,
          videoUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.meeting.findMany.mockResolvedValue(mockItems as never);
      mockDb.meeting.count.mockResolvedValue(1);

      const result = await service.getMeetings(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getMeeting', () => {
    it('should return a single meeting by ID', async () => {
      const mockMeeting = { id: '1', title: 'Test Meeting' };
      mockDb.meeting.findUnique.mockResolvedValue(mockMeeting as never);

      const result = await service.getMeeting('1');

      expect(result).toEqual(mockMeeting);
    });

    it('should return null when not found', async () => {
      mockDb.meeting.findUnique.mockResolvedValue(null);

      const result = await service.getMeeting('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getRepresentatives', () => {
    it('should return paginated representatives', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'rep-1',
          name: 'John Doe',
          chamber: 'Senate',
          district: 'D1',
          party: 'Independent',
          photoUrl: null,
          contactInfo: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.representative.findMany.mockResolvedValue(mockItems as never);
      mockDb.representative.count.mockResolvedValue(1);

      const result = await service.getRepresentatives(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by chamber when provided', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);
      mockDb.representative.count.mockResolvedValue(0);

      await service.getRepresentatives(0, 10, 'Senate');

      expect(mockDb.representative.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chamber: 'Senate' },
        }),
      );
    });
  });

  describe('getRepresentative', () => {
    it('should return a single representative by ID', async () => {
      const mockRep = { id: '1', name: 'John Doe' };
      mockDb.representative.findUnique.mockResolvedValue(mockRep as never);

      const result = await service.getRepresentative('1');

      expect(result).toEqual(mockRep);
    });
  });

  describe('getRepresentativesByDistricts', () => {
    it('should return empty array when no districts provided', async () => {
      mockDb.representative.findMany.mockClear();

      const result = await service.getRepresentativesByDistricts();

      expect(result).toEqual([]);
      expect(mockDb.representative.findMany).not.toHaveBeenCalled();
    });

    it('matches BOTH padded and unpadded district forms for both chambers', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      await service.getRepresentativesByDistricts(
        undefined,
        'State Senate District 5',
        'Assembly District 12',
      );

      expect(mockDb.representative.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { chamber: 'Assembly', district: '12' },
            { chamber: 'Assembly', district: '12' },
            { chamber: 'Senate', district: '05' },
            { chamber: 'Senate', district: '5' },
          ],
        },
        orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
      });
    });

    it('emits both "02" and "2" for a single-digit Senate district', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      await service.getRepresentativesByDistricts(
        undefined,
        'State Senate District 2',
        undefined,
      );

      expect(mockDb.representative.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { chamber: 'Senate', district: '02' },
            { chamber: 'Senate', district: '2' },
          ],
        },
        orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
      });
    });

    it('emits unpadded "12" for an Assembly two-digit district', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      await service.getRepresentativesByDistricts(
        undefined,
        undefined,
        'Assembly District 12',
      );

      expect(mockDb.representative.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { chamber: 'Assembly', district: '12' },
            { chamber: 'Assembly', district: '12' },
          ],
        },
        orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
      });
    });

    it('should return matching representatives from db', async () => {
      const mockReps = [
        {
          id: '1',
          externalId: 'rep-1',
          name: 'Jane Senator',
          chamber: 'Senate',
          district: '05',
          party: 'Democratic',
          photoUrl: null,
          contactInfo: null,
          bio: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.representative.findMany.mockResolvedValue(mockReps as never);

      const result = await service.getRepresentativesByDistricts(
        undefined,
        'State Senate District 5',
        undefined,
      );

      expect(result).toEqual(mockReps);
    });
  });

  describe('getRepresentativeActivityStats', () => {
    it('returns zero counts when the rep does not exist', async () => {
      mockDb.representative.findUnique.mockResolvedValue(null);

      const result = await service.getRepresentativeActivityStats(
        'missing',
        90,
      );

      expect(result).toEqual({
        presentSessionDays: 0,
        totalSessionDays: 0,
        absenceDays: 0,
        amendments: 0,
        committeeHearings: 0,
        committeeReports: 0,
        resolutions: 0,
        votes: 0,
        speeches: 0,
      });
    });

    it('aggregates groupBy + distinct-day queries into typed counters', async () => {
      mockDb.representative.findUnique.mockResolvedValue({
        chamber: 'Assembly',
      } as never);
      mockDb.legislativeAction.groupBy.mockResolvedValue([
        { actionType: 'amendment', _count: { _all: 7 } },
        { actionType: 'committee_hearing', _count: { _all: 3 } },
        { actionType: 'committee_report', _count: { _all: 12 } },
        { actionType: 'resolution', _count: { _all: 1 } },
      ] as never);
      (mockDb.legislativeAction.findMany as jest.Mock).mockImplementation(
        (args: { where?: Record<string, unknown> }) => {
          if (args.where?.position === 'yes') {
            return Promise.resolve(
              Array.from({ length: 18 }, (_, i) => ({
                date: new Date(2026, 3, i + 1),
              })),
            );
          }
          if (args.where?.position === 'absent') {
            return Promise.resolve([{ date: new Date('2026-04-15') }]);
          }
          return Promise.resolve(
            Array.from({ length: 22 }, (_, i) => ({
              date: new Date(2026, 3, i + 1),
            })),
          );
        },
      );

      const result = await service.getRepresentativeActivityStats('rep-1', 90);

      expect(result.presentSessionDays).toBe(18);
      expect(result.totalSessionDays).toBe(22);
      expect(result.absenceDays).toBe(1);
      expect(result.amendments).toBe(7);
      expect(result.committeeHearings).toBe(3);
      expect(result.committeeReports).toBe(12);
      expect(result.resolutions).toBe(1);
    });
  });

  describe('getRepresentativeActivity', () => {
    it('paginates + filters out presence:yes by default', async () => {
      mockDb.legislativeAction.findMany.mockResolvedValue([
        {
          id: 'la-1',
          externalId: 'ext-1',
          body: 'Assembly',
          date: new Date('2026-04-28'),
          actionType: 'amendment',
          position: null,
          text: 'Amendment text',
          passageStart: 100,
          passageEnd: 200,
          rawSubject: 'AB 1897',
          representativeId: 'rep-1',
          propositionId: null,
          committeeId: 'cmt-1',
          minutesId: 'min-1',
          minutes: { externalId: 'meet-1' },
        },
      ] as never);
      mockDb.legislativeAction.count.mockResolvedValue(1);

      const result = await service.getRepresentativeActivity({
        representativeId: 'rep-1',
        skip: 0,
        take: 10,
      });

      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0].minutesExternalId).toBe('meet-1');
      const findManyCall = mockDb.legislativeAction.findMany.mock
        .calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(findManyCall.where.NOT).toBeDefined();
    });

    it('forwards explicit actionTypes when provided', async () => {
      mockDb.legislativeAction.findMany.mockResolvedValue([] as never);
      mockDb.legislativeAction.count.mockResolvedValue(0);

      await service.getRepresentativeActivity({
        representativeId: 'rep-1',
        actionTypes: ['committee_hearing'],
      });

      const findManyCall = mockDb.legislativeAction.findMany.mock
        .calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(findManyCall.where.actionType).toEqual({
        in: ['committee_hearing'],
      });
    });

    it('hasMore=true when results exceed take', async () => {
      mockDb.legislativeAction.findMany.mockResolvedValue(
        Array.from({ length: 11 }, (_, i) => ({
          id: `la-${i}`,
          externalId: `ext-${i}`,
          body: 'Assembly',
          date: new Date('2026-04-28'),
          actionType: 'amendment',
          position: null,
          text: null,
          passageStart: null,
          passageEnd: null,
          rawSubject: null,
          representativeId: 'rep-1',
          propositionId: null,
          committeeId: null,
          minutesId: 'min-1',
          minutes: { externalId: 'meet-1' },
        })) as never,
      );
      mockDb.legislativeAction.count.mockResolvedValue(50);

      const result = await service.getRepresentativeActivity({
        representativeId: 'rep-1',
        take: 10,
      });

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getMinutesPassage', () => {
    it('returns null when the action does not exist', async () => {
      mockDb.legislativeAction.findUnique.mockResolvedValue(null);
      const result = await service.getMinutesPassage('missing');
      expect(result).toBeNull();
    });

    it('returns null when the parent Minutes has no rawText', async () => {
      mockDb.legislativeAction.findUnique.mockResolvedValue({
        id: 'la-1',
        passageStart: 0,
        passageEnd: 10,
        minutes: { rawText: null },
      } as never);
      const result = await service.getMinutesPassage('la-1');
      expect(result).toBeNull();
    });

    it('slices passageText, caps at 1kB, and snaps context window', async () => {
      const rawText =
        'Lots of preceding context. ' +
        'PASSAGE_BEGIN here is the action body PASSAGE_END ' +
        'And then trailing context that flows on for some chars.';
      const start = rawText.indexOf('PASSAGE_BEGIN');
      const end = rawText.indexOf('PASSAGE_END') + 'PASSAGE_END'.length;

      mockDb.legislativeAction.findUnique.mockResolvedValue({
        id: 'la-1',
        passageStart: start,
        passageEnd: end,
        minutes: {
          externalId: 'meet-1',
          body: 'Assembly',
          date: new Date('2026-04-28'),
          sourceUrl: 'https://example/journal.pdf',
          rawText,
        },
      } as never);

      const result = await service.getMinutesPassage('la-1');
      expect(result).not.toBeNull();
      expect(result?.passageText).toContain('PASSAGE_BEGIN');
      expect(result?.passageText).toContain('PASSAGE_END');
      expect(result?.minutesExternalId).toBe('meet-1');
      expect(result?.sectionContext).toContain('preceding context');
    });
  });

  describe('getCommitteeActivityStats', () => {
    it('aggregates groupBy + distinct propositionIds', async () => {
      mockDb.legislativeAction.groupBy.mockResolvedValue([
        { actionType: 'committee_hearing', _count: { _all: 7 } },
        { actionType: 'committee_report', _count: { _all: 43 } },
        { actionType: 'amendment', _count: { _all: 41 } },
      ] as never);
      mockDb.legislativeAction.findMany.mockResolvedValue([
        { propositionId: 'p1' },
        { propositionId: 'p2' },
        { propositionId: 'p3' },
      ] as never);

      const result = await service.getCommitteeActivityStats('cmt-1', 90);

      expect(result.hearings).toBe(7);
      expect(result.reports).toBe(43);
      expect(result.amendments).toBe(41);
      expect(result.distinctBills).toBe(3);
    });
  });

  describe('getCommitteeActivity', () => {
    it('returns paginated feed scoped by committeeId', async () => {
      mockDb.legislativeAction.findMany.mockResolvedValue([
        {
          id: 'la-1',
          externalId: 'ext-1',
          body: 'Assembly',
          date: new Date('2026-04-28'),
          actionType: 'committee_report',
          position: null,
          text: 'Do pass.',
          passageStart: 100,
          passageEnd: 110,
          rawSubject: 'AB 1897',
          representativeId: null,
          propositionId: null,
          committeeId: 'cmt-1',
          minutesId: 'min-1',
          minutes: { externalId: 'meet-1' },
        },
      ] as never);
      mockDb.legislativeAction.count.mockResolvedValue(1);

      const result = await service.getCommitteeActivity({
        committeeId: 'cmt-1',
      });

      expect(result.total).toBe(1);
      expect(result.items[0].committeeId).toBe('cmt-1');
      expect(result.items[0].minutesExternalId).toBe('meet-1');
    });

    it('forwards actionTypes filter to Prisma', async () => {
      mockDb.legislativeAction.findMany.mockResolvedValue([] as never);
      mockDb.legislativeAction.count.mockResolvedValue(0);

      await service.getCommitteeActivity({
        committeeId: 'cmt-1',
        actionTypes: ['committee_hearing'],
      });

      const findManyCall = mockDb.legislativeAction.findMany.mock
        .calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(findManyCall.where.actionType).toEqual({
        in: ['committee_hearing'],
      });
    });
  });

  describe('getCommittees', () => {
    it('should return paginated committees', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'comm-1',
          name: 'Test Committee',
          type: 'pac',
          candidateName: null,
          candidateOffice: null,
          propositionId: null,
          party: null,
          status: 'active',
          sourceSystem: 'cal-access',
          sourceUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.committee.findMany.mockResolvedValue(mockItems);
      mockDb.committee.count.mockResolvedValue(1);

      const result = await service.getCommittees(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0].candidateName).toBeUndefined();
      expect(result.items[0].sourceUrl).toBeUndefined();
    });

    it('should filter by sourceSystem when provided', async () => {
      mockDb.committee.findMany.mockResolvedValue([]);
      mockDb.committee.count.mockResolvedValue(0);

      await service.getCommittees(0, 10, 'cal-access');

      expect(mockDb.committee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourceSystem: 'cal-access' },
        }),
      );
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        externalId: `comm-${i}`,
        name: `Committee ${i}`,
        type: 'pac',
        candidateName: null,
        candidateOffice: null,
        propositionId: null,
        party: null,
        status: 'active',
        sourceSystem: 'cal-access',
        sourceUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));
      mockDb.committee.findMany.mockResolvedValue(mockItems);
      mockDb.committee.count.mockResolvedValue(15);

      const result = await service.getCommittees(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getCommittee', () => {
    it('should return a single committee by ID', async () => {
      const mockComm = { id: '1', name: 'Test Committee' };
      mockDb.committee.findUnique.mockResolvedValue(mockComm as never);

      const result = await service.getCommittee('1');

      expect(result).toEqual(mockComm);
      expect(mockDb.committee.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if committee not found', async () => {
      mockDb.committee.findUnique.mockResolvedValue(null);

      const result = await service.getCommittee('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getContributions', () => {
    it('should return paginated contributions with Decimal-to-number conversion', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'contrib-1',
          committeeId: 'comm-1',
          donorName: 'Jane Smith',
          donorType: 'individual',
          donorEmployer: null,
          donorOccupation: null,
          donorCity: null,
          donorState: null,
          donorZip: null,
          amount: { toNumber: () => 500 } as unknown as Prisma.Decimal,
          date: new Date(),
          electionType: null,
          contributionType: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.contribution.findMany.mockResolvedValue(mockItems as never);
      mockDb.contribution.count.mockResolvedValue(1);

      const result = await service.getContributions(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(typeof result.items[0].amount).toBe('number');
      expect(result.items[0].donorEmployer).toBeUndefined();
      expect(result.items[0].electionType).toBeUndefined();
    });

    it('should filter by committeeId and sourceSystem', async () => {
      mockDb.contribution.findMany.mockResolvedValue([]);
      mockDb.contribution.count.mockResolvedValue(0);

      await service.getContributions(0, 10, 'comm-1', 'cal-access');

      expect(mockDb.contribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { committeeId: 'comm-1', sourceSystem: 'cal-access' },
        }),
      );
    });
  });

  describe('getContribution', () => {
    it('should return a single contribution by ID', async () => {
      const mockContrib = { id: '1', donorName: 'Jane Smith' };
      mockDb.contribution.findUnique.mockResolvedValue(mockContrib as never);

      const result = await service.getContribution('1');

      expect(result).toEqual(mockContrib);
      expect(mockDb.contribution.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if contribution not found', async () => {
      mockDb.contribution.findUnique.mockResolvedValue(null);

      const result = await service.getContribution('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getExpenditures', () => {
    it('should return paginated expenditures with Decimal-to-number conversion', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'exp-1',
          committeeId: 'comm-1',
          payeeName: 'Ad Agency Inc',
          amount: { toNumber: () => 1500 } as unknown as Prisma.Decimal,
          date: new Date(),
          purposeDescription: null,
          expenditureCode: null,
          candidateName: null,
          propositionTitle: null,
          supportOrOppose: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.expenditure.findMany.mockResolvedValue(mockItems as never);
      mockDb.expenditure.count.mockResolvedValue(1);

      const result = await service.getExpenditures(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(typeof result.items[0].amount).toBe('number');
      expect(result.items[0].purposeDescription).toBeUndefined();
      expect(result.items[0].supportOrOppose).toBeUndefined();
    });

    it('should filter by committeeId and sourceSystem', async () => {
      mockDb.expenditure.findMany.mockResolvedValue([]);
      mockDb.expenditure.count.mockResolvedValue(0);

      await service.getExpenditures(0, 10, 'comm-1', 'cal-access');

      expect(mockDb.expenditure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { committeeId: 'comm-1', sourceSystem: 'cal-access' },
        }),
      );
    });
  });

  describe('getExpenditure', () => {
    it('should return a single expenditure by ID', async () => {
      const mockExp = { id: '1', payeeName: 'Ad Agency Inc' };
      mockDb.expenditure.findUnique.mockResolvedValue(mockExp as never);

      const result = await service.getExpenditure('1');

      expect(result).toEqual(mockExp);
      expect(mockDb.expenditure.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if expenditure not found', async () => {
      mockDb.expenditure.findUnique.mockResolvedValue(null);

      const result = await service.getExpenditure('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getIndependentExpenditures', () => {
    it('should return paginated independent expenditures with Decimal-to-number conversion', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'ie-1',
          committeeId: 'comm-1',
          committeeName: 'Test IE Committee',
          candidateName: null,
          propositionTitle: null,
          supportOrOppose: 'support',
          amount: { toNumber: () => 25000 } as unknown as Prisma.Decimal,
          date: new Date(),
          electionDate: null,
          description: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.independentExpenditure.findMany.mockResolvedValue(
        mockItems as never,
      );
      mockDb.independentExpenditure.count.mockResolvedValue(1);

      const result = await service.getIndependentExpenditures(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(typeof result.items[0].amount).toBe('number');
      expect(result.items[0].candidateName).toBeUndefined();
      expect(result.items[0].description).toBeUndefined();
      expect(result.items[0].supportOrOppose).toBe('support');
    });

    it('should filter by committeeId, supportOrOppose, and sourceSystem', async () => {
      mockDb.independentExpenditure.findMany.mockResolvedValue([]);
      mockDb.independentExpenditure.count.mockResolvedValue(0);

      await service.getIndependentExpenditures(
        0,
        10,
        'comm-1',
        'support',
        'cal-access',
      );

      expect(mockDb.independentExpenditure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            committeeId: 'comm-1',
            supportOrOppose: 'support',
            sourceSystem: 'cal-access',
          },
        }),
      );
    });
  });

  describe('getIndependentExpenditure', () => {
    it('should return a single independent expenditure by ID', async () => {
      const mockIE = { id: '1', committeeName: 'Test IE Committee' };
      mockDb.independentExpenditure.findUnique.mockResolvedValue(
        mockIE as never,
      );

      const result = await service.getIndependentExpenditure('1');

      expect(result).toEqual(mockIE);
      expect(mockDb.independentExpenditure.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if independent expenditure not found', async () => {
      mockDb.independentExpenditure.findUnique.mockResolvedValue(null);

      const result = await service.getIndependentExpenditure('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getPropositionFunding', () => {
    it('delegates to the funding service when available', async () => {
      const mockFunding = {
        getFunding: jest.fn().mockResolvedValue({
          propositionId: 'prop-1',
          asOf: new Date(),
          support: {
            totalRaised: 0,
            totalSpent: 0,
            donorCount: 0,
            committeeCount: 0,
            topDonors: [],
            primaryCommittees: [],
          },
          oppose: {
            totalRaised: 0,
            totalSpent: 0,
            donorCount: 0,
            committeeCount: 0,
            topDonors: [],
            primaryCommittees: [],
          },
        }),
      };

      // Build a fresh service with the funding mock injected via overrideProvider
      const moduleWithFundingOverride = await Test.createTestingModule({
        providers: [
          { provide: REGION_CACHE, useValue: mockCache },
          RegionCacheService,
          { provide: DbService, useValue: mockDb },
          RegionQueryService,
        ],
      })
        .overrideProvider(RegionQueryService)
        .useFactory({
          factory: (db: DbService, cache: RegionCacheService) =>
            new RegionQueryService(db, cache, mockFunding as never),
          inject: [DbService, RegionCacheService],
        })
        .compile();

      const svc =
        moduleWithFundingOverride.get<RegionQueryService>(RegionQueryService);
      const out = await svc.getPropositionFunding('prop-1');

      expect(mockFunding.getFunding).toHaveBeenCalledWith('prop-1');
      expect(out).not.toBeNull();
    });

    it('returns null when funding service is absent', async () => {
      // service created in beforeEach has no funding provider
      const result = await service.getPropositionFunding('prop-1');
      expect(result).toBeNull();
    });
  });
});
