/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { RegionResolver } from './region.resolver';
import { RegionDomainService } from './region.service';
import { DataType } from '@opuspopuli/region-provider';
import { DataTypeGQL } from './models/region-info.model';

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
      DataTypeGQL.PROPOSITIONS,
      DataTypeGQL.MEETINGS,
      DataTypeGQL.REPRESENTATIVES,
    ],
  };

  const mockProposition: any = {
    id: '1',
    externalId: 'prop-1',
    title: 'Test Proposition',
    summary: 'Summary',
    fullText: null,
    status: 'pending',
    electionDate: null,
    sourceUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockMeeting: any = {
    id: '1',
    externalId: 'meeting-1',
    title: 'Test Meeting',
    body: 'Council',
    scheduledAt: new Date(),
    location: null,
    agendaUrl: null,
    videoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockRepresentative: any = {
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
  };

  const mockCommittee: any = {
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
  };

  const mockContribution: any = {
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
    amount: 500,
    date: new Date(),
    electionType: null,
    contributionType: null,
    sourceSystem: 'cal-access',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockExpenditure: any = {
    id: '1',
    externalId: 'exp-1',
    committeeId: 'comm-1',
    payeeName: 'Ad Agency Inc',
    amount: 1500,
    date: new Date(),
    purposeDescription: null,
    expenditureCode: null,
    candidateName: null,
    propositionTitle: null,
    supportOrOppose: null,
    sourceSystem: 'cal-access',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockIndependentExpenditure: any = {
    id: '1',
    externalId: 'ie-1',
    committeeId: 'comm-1',
    committeeName: 'Test IE Committee',
    candidateName: null,
    propositionTitle: null,
    supportOrOppose: 'support',
    amount: 25000,
    date: new Date(),
    electionDate: null,
    description: null,
    sourceSystem: 'cal-access',
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
        items: [mockProposition],
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
        items: [],
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
      regionService.getProposition.mockResolvedValue(mockProposition);

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
      regionService.getMeeting.mockResolvedValue(mockMeeting);

      const result = await resolver.meeting('1');

      // Resolver converts null to undefined for optional fields
      expect(result).toEqual({
        ...mockMeeting,
        location: undefined,
        agendaUrl: undefined,
        videoUrl: undefined,
      });
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
      regionService.getRepresentative.mockResolvedValue(mockRepresentative);

      const result = await resolver.representative('1');

      // Resolver converts null to undefined for optional fields
      expect(result).toEqual({
        ...mockRepresentative,
        photoUrl: undefined,
        contactInfo: undefined,
      });
      expect(regionService.getRepresentative).toHaveBeenCalledWith('1');
    });

    it('should return null if representative not found', async () => {
      regionService.getRepresentative.mockResolvedValue(null);

      const result = await resolver.representative('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ==========================================
  // CAMPAIGN FINANCE QUERIES
  // ==========================================

  describe('committees', () => {
    it('should return paginated committees', async () => {
      const mockPaginatedResult = {
        items: [mockCommittee],
        total: 1,
        hasMore: false,
      };
      regionService.getCommittees.mockResolvedValue(mockPaginatedResult);

      const result = await resolver.committees(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getCommittees).toHaveBeenCalledWith(
        0,
        10,
        undefined,
      );
    });

    it('should filter by sourceSystem when provided', async () => {
      const mockPaginatedResult = {
        items: [mockCommittee],
        total: 1,
        hasMore: false,
      };
      regionService.getCommittees.mockResolvedValue(mockPaginatedResult);

      await resolver.committees(0, 10, 'cal-access');

      expect(regionService.getCommittees).toHaveBeenCalledWith(
        0,
        10,
        'cal-access',
      );
    });
  });

  describe('committee', () => {
    it('should return a single committee', async () => {
      regionService.getCommittee.mockResolvedValue(mockCommittee);

      const result = await resolver.committee('1');

      expect(result).toEqual({
        ...mockCommittee,
        candidateName: undefined,
        candidateOffice: undefined,
        propositionId: undefined,
        party: undefined,
        sourceUrl: undefined,
      });
      expect(regionService.getCommittee).toHaveBeenCalledWith('1');
    });

    it('should return null if committee not found', async () => {
      regionService.getCommittee.mockResolvedValue(null);

      const result = await resolver.committee('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('contributions', () => {
    it('should return paginated contributions', async () => {
      const mockPaginatedResult = {
        items: [mockContribution],
        total: 1,
        hasMore: false,
      };
      regionService.getContributions.mockResolvedValue(mockPaginatedResult);

      const result = await resolver.contributions(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getContributions).toHaveBeenCalledWith(
        0,
        10,
        undefined,
        undefined,
      );
    });

    it('should filter by committeeId and sourceSystem', async () => {
      const mockPaginatedResult = {
        items: [mockContribution],
        total: 1,
        hasMore: false,
      };
      regionService.getContributions.mockResolvedValue(mockPaginatedResult);

      await resolver.contributions(0, 10, 'comm-1', 'cal-access');

      expect(regionService.getContributions).toHaveBeenCalledWith(
        0,
        10,
        'comm-1',
        'cal-access',
      );
    });
  });

  describe('contribution', () => {
    it('should return a single contribution with amount as number', async () => {
      regionService.getContribution.mockResolvedValue(mockContribution);

      const result = await resolver.contribution('1');

      expect(result).toEqual({
        ...mockContribution,
        amount: 500,
        donorEmployer: undefined,
        donorOccupation: undefined,
        donorCity: undefined,
        donorState: undefined,
        donorZip: undefined,
        electionType: undefined,
        contributionType: undefined,
      });
      expect(regionService.getContribution).toHaveBeenCalledWith('1');
    });

    it('should return null if contribution not found', async () => {
      regionService.getContribution.mockResolvedValue(null);

      const result = await resolver.contribution('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('expenditures', () => {
    it('should return paginated expenditures', async () => {
      const mockPaginatedResult = {
        items: [mockExpenditure],
        total: 1,
        hasMore: false,
      };
      regionService.getExpenditures.mockResolvedValue(mockPaginatedResult);

      const result = await resolver.expenditures(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getExpenditures).toHaveBeenCalledWith(
        0,
        10,
        undefined,
        undefined,
      );
    });

    it('should filter by committeeId and sourceSystem', async () => {
      const mockPaginatedResult = {
        items: [mockExpenditure],
        total: 1,
        hasMore: false,
      };
      regionService.getExpenditures.mockResolvedValue(mockPaginatedResult);

      await resolver.expenditures(0, 10, 'comm-1', 'cal-access');

      expect(regionService.getExpenditures).toHaveBeenCalledWith(
        0,
        10,
        'comm-1',
        'cal-access',
      );
    });
  });

  describe('expenditure', () => {
    it('should return a single expenditure with amount as number', async () => {
      regionService.getExpenditure.mockResolvedValue(mockExpenditure);

      const result = await resolver.expenditure('1');

      expect(result).toEqual({
        ...mockExpenditure,
        amount: 1500,
        purposeDescription: undefined,
        expenditureCode: undefined,
        candidateName: undefined,
        propositionTitle: undefined,
        supportOrOppose: undefined,
      });
      expect(regionService.getExpenditure).toHaveBeenCalledWith('1');
    });

    it('should return null if expenditure not found', async () => {
      regionService.getExpenditure.mockResolvedValue(null);

      const result = await resolver.expenditure('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('independentExpenditures', () => {
    it('should return paginated independent expenditures', async () => {
      const mockPaginatedResult = {
        items: [mockIndependentExpenditure],
        total: 1,
        hasMore: false,
      };
      regionService.getIndependentExpenditures.mockResolvedValue(
        mockPaginatedResult,
      );

      const result = await resolver.independentExpenditures(0, 10);

      expect(result).toEqual(mockPaginatedResult);
      expect(regionService.getIndependentExpenditures).toHaveBeenCalledWith(
        0,
        10,
        undefined,
        undefined,
        undefined,
      );
    });

    it('should filter by committeeId, supportOrOppose, and sourceSystem', async () => {
      const mockPaginatedResult = {
        items: [mockIndependentExpenditure],
        total: 1,
        hasMore: false,
      };
      regionService.getIndependentExpenditures.mockResolvedValue(
        mockPaginatedResult,
      );

      await resolver.independentExpenditures(
        0,
        10,
        'comm-1',
        'support',
        'cal-access',
      );

      expect(regionService.getIndependentExpenditures).toHaveBeenCalledWith(
        0,
        10,
        'comm-1',
        'support',
        'cal-access',
      );
    });
  });

  describe('independentExpenditure', () => {
    it('should return a single independent expenditure with amount as number', async () => {
      regionService.getIndependentExpenditure.mockResolvedValue(
        mockIndependentExpenditure,
      );

      const result = await resolver.independentExpenditure('1');

      expect(result).toEqual({
        ...mockIndependentExpenditure,
        amount: 25000,
        candidateName: undefined,
        propositionTitle: undefined,
        electionDate: undefined,
        description: undefined,
      });
      expect(regionService.getIndependentExpenditure).toHaveBeenCalledWith('1');
    });

    it('should return null if independent expenditure not found', async () => {
      regionService.getIndependentExpenditure.mockResolvedValue(null);

      const result = await resolver.independentExpenditure('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('syncRegionData', () => {
    it('should trigger sync and return results', async () => {
      const mockSyncResults = [
        {
          dataType: DataType.PROPOSITIONS,
          itemsProcessed: 10,
          itemsCreated: 5,
          itemsUpdated: 5,
          errors: [],
          syncedAt: new Date(),
        },
        {
          dataType: DataType.MEETINGS,
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
          dataType: DataType.PROPOSITIONS,
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
