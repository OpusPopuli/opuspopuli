import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { RegionResolver } from './region.resolver';
import { RegionDomainService } from './region.service';
import { CivicDataType } from '@qckstrt/region-provider';
import { CivicDataTypeGQL } from './models/region-info.model';
import { PropositionModel } from './models/proposition.model';
import { MeetingModel } from './models/meeting.model';
import { RepresentativeModel } from './models/representative.model';

describe('RegionResolver', () => {
  let resolver: RegionResolver;
  let regionService: jest.Mocked<RegionDomainService>;

  const mockRegionInfo = {
    id: 'test-region',
    name: 'Test Region',
    description: 'A test region',
    timezone: 'America/Los_Angeles',
    dataSourceUrls: ['https://example.com'],
    supportedDataTypes: [
      CivicDataTypeGQL.PROPOSITIONS,
      CivicDataTypeGQL.MEETINGS,
      CivicDataTypeGQL.REPRESENTATIVES,
    ],
  };

  const mockProposition = {
    id: '1',
    externalId: 'prop-1',
    title: 'Test Proposition',
    summary: 'Summary',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMeeting = {
    id: '1',
    externalId: 'meeting-1',
    title: 'Test Meeting',
    body: 'Council',
    scheduledAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepresentative = {
    id: '1',
    externalId: 'rep-1',
    name: 'John Doe',
    chamber: 'Senate',
    district: 'D1',
    party: 'Independent',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockRegionService = createMock<RegionDomainService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionResolver,
        {
          provide: RegionDomainService,
          useValue: mockRegionService,
        },
      ],
    }).compile();

    resolver = module.get<RegionResolver>(RegionResolver);
    regionService = module.get(RegionDomainService);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  describe('regionInfo', () => {
    it('should return region info', async () => {
      regionService.getRegionInfo.mockReturnValue(mockRegionInfo);

      const result = await resolver.regionInfo();

      expect(result).toEqual(mockRegionInfo);
      expect(regionService.getRegionInfo).toHaveBeenCalled();
    });
  });

  describe('propositions', () => {
    it('should return paginated propositions', async () => {
      const mockPaginatedResult = {
        items: [mockProposition as PropositionModel],
        total: 1,
        hasMore: false,
      };
      regionService.getPropositions.mockResolvedValue(mockPaginatedResult);

      const result = await resolver.propositions(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getPropositions).toHaveBeenCalledWith(0, 10);
    });

    it('should use default pagination values', async () => {
      const mockPaginatedResult = {
        items: [] as PropositionModel[],
        total: 0,
        hasMore: false,
      };
      regionService.getPropositions.mockResolvedValue(mockPaginatedResult);

      await resolver.propositions(0, 10);

      expect(regionService.getPropositions).toHaveBeenCalledWith(0, 10);
    });
  });

  describe('proposition', () => {
    it('should return a single proposition', async () => {
      regionService.getProposition.mockResolvedValue(
        mockProposition as PropositionModel,
      );

      const result = await resolver.proposition('1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('1');
      expect(regionService.getProposition).toHaveBeenCalledWith('1');
    });

    it('should return null if proposition not found', async () => {
      regionService.getProposition.mockResolvedValue(null);

      const result = await resolver.proposition('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('meetings', () => {
    it('should return paginated meetings', async () => {
      const mockPaginatedResult = {
        items: [mockMeeting],
        total: 1,
        hasMore: false,
      };
      regionService.getMeetings.mockResolvedValue(mockPaginatedResult);

      const result = await resolver.meetings(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getMeetings).toHaveBeenCalledWith(0, 10);
    });
  });

  describe('meeting', () => {
    it('should return a single meeting', async () => {
      regionService.getMeeting.mockResolvedValue(mockMeeting as MeetingModel);

      const result = await resolver.meeting('1');

      expect(result).toEqual(mockMeeting);
      expect(regionService.getMeeting).toHaveBeenCalledWith('1');
    });

    it('should return null if meeting not found', async () => {
      regionService.getMeeting.mockResolvedValue(null);

      const result = await resolver.meeting('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('representatives', () => {
    it('should return paginated representatives', async () => {
      const mockPaginatedResult = {
        items: [mockRepresentative],
        total: 1,
        hasMore: false,
      };
      regionService.getRepresentatives.mockResolvedValue(mockPaginatedResult);

      const result = await resolver.representatives(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getRepresentatives).toHaveBeenCalledWith(
        0,
        10,
        undefined,
      );
    });

    it('should filter by chamber when provided', async () => {
      const mockPaginatedResult = {
        items: [mockRepresentative],
        total: 1,
        hasMore: false,
      };
      regionService.getRepresentatives.mockResolvedValue(mockPaginatedResult);

      await resolver.representatives(0, 10, 'Senate');

      expect(regionService.getRepresentatives).toHaveBeenCalledWith(
        0,
        10,
        'Senate',
      );
    });
  });

  describe('representative', () => {
    it('should return a single representative', async () => {
      regionService.getRepresentative.mockResolvedValue(
        mockRepresentative as RepresentativeModel,
      );

      const result = await resolver.representative('1');

      expect(result).toEqual(mockRepresentative);
      expect(regionService.getRepresentative).toHaveBeenCalledWith('1');
    });

    it('should return null if representative not found', async () => {
      regionService.getRepresentative.mockResolvedValue(null);

      const result = await resolver.representative('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('syncRegionData', () => {
    it('should trigger sync and return results', async () => {
      const mockSyncResults = [
        {
          dataType: CivicDataType.PROPOSITIONS,
          itemsProcessed: 10,
          itemsCreated: 5,
          itemsUpdated: 5,
          errors: [],
          syncedAt: new Date(),
        },
        {
          dataType: CivicDataType.MEETINGS,
          itemsProcessed: 5,
          itemsCreated: 3,
          itemsUpdated: 2,
          errors: [],
          syncedAt: new Date(),
        },
      ];
      regionService.syncAll.mockResolvedValue(mockSyncResults);

      const result = await resolver.syncRegionData();

      expect(result).toHaveLength(2);
      expect(result[0].itemsProcessed).toBe(10);
      expect(regionService.syncAll).toHaveBeenCalled();
    });

    it('should include errors in sync results', async () => {
      const mockSyncResults = [
        {
          dataType: CivicDataType.PROPOSITIONS,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          errors: ['Network error'],
          syncedAt: new Date(),
        },
      ];
      regionService.syncAll.mockResolvedValue(mockSyncResults);

      const result = await resolver.syncRegionData();

      expect(result[0].errors).toContain('Network error');
    });
  });
});
