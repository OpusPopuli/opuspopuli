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
    it('should return region info with civics merged in', async () => {
      regionService.getRegionInfo.mockReturnValue(mockRegionInfo);
      (regionService.getCivicsData as jest.Mock).mockResolvedValue(null);

      const result = await resolver.regionInfo();

      expect(result).toEqual({ ...mockRegionInfo, civics: undefined });
      expect(regionService.getRegionInfo).toHaveBeenCalled();
      expect(regionService.getCivicsData).toHaveBeenCalledWith(
        mockRegionInfo.id,
      );
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

      const result = await resolver.propositions({ skip: 0, take: 10 });

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

      await resolver.propositions({ skip: 0, take: 10 });

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

  describe('propositionFunding', () => {
    const mockFunding = {
      propositionId: 'prop-1',
      asOf: new Date('2026-04-25T00:00:00Z'),
      support: {
        totalRaised: 100_000,
        totalSpent: 80_000,
        donorCount: 5,
        committeeCount: 1,
        topDonors: [
          { donorName: 'A. Donor', totalAmount: 50_000, contributionCount: 2 },
        ],
        primaryCommittees: [
          { id: 'c-1', name: 'Yes on Prop 1', totalRaised: 100_000 },
        ],
      },
      oppose: {
        totalRaised: 0,
        totalSpent: 0,
        donorCount: 0,
        committeeCount: 0,
        topDonors: [],
        primaryCommittees: [],
      },
    };

    it('returns the aggregated funding shape from the service', async () => {
      regionService.getPropositionFunding.mockResolvedValue(mockFunding as any);

      const result = await resolver.propositionFunding('prop-1');

      expect(result).not.toBeNull();
      expect(result?.support.totalRaised).toBe(100_000);
      expect(result?.support.topDonors[0].donorName).toBe('A. Donor');
      expect(regionService.getPropositionFunding).toHaveBeenCalledWith(
        'prop-1',
      );
    });

    it('returns null when the service has no funding data wired', async () => {
      regionService.getPropositionFunding.mockResolvedValue(null);

      const result = await resolver.propositionFunding('prop-1');

      expect(result).toBeNull();
    });
  });

  describe('regeneratePropositionAnalysis', () => {
    it('should re-fetch and return the proposition after a successful regenerate', async () => {
      regionService.regeneratePropositionAnalysis.mockResolvedValue(true);
      regionService.getProposition.mockResolvedValue(mockProposition);

      const result = await resolver.regeneratePropositionAnalysis('1');

      expect(regionService.regeneratePropositionAnalysis).toHaveBeenCalledWith(
        '1',
      );
      expect(regionService.getProposition).toHaveBeenCalledWith('1');
      expect(result?.id).toBe('1');
    });

    it('should return null when the proposition vanishes between regenerate and fetch', async () => {
      regionService.regeneratePropositionAnalysis.mockResolvedValue(false);
      regionService.getProposition.mockResolvedValue(null);

      const result = await resolver.regeneratePropositionAnalysis('missing');

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

      const result = await resolver.meetings({ skip: 0, take: 10 });

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

      const result = await resolver.representatives({ skip: 0, take: 10 });

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

      await resolver.representatives({ skip: 0, take: 10 }, 'Senate');

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

  describe('representativesByDistricts', () => {
    it('should call service with district strings', async () => {
      regionService.getRepresentativesByDistricts.mockResolvedValue([
        mockRepresentative,
      ]);

      const result = await resolver.representativesByDistricts(
        'Congressional District 2',
        'State Senate District 5',
        'Assembly District 12',
      );

      expect(regionService.getRepresentativesByDistricts).toHaveBeenCalledWith(
        'Congressional District 2',
        'State Senate District 5',
        'Assembly District 12',
      );
      expect(result).toHaveLength(1);
    });

    it('should convert null party/photoUrl/bio to undefined', async () => {
      const repWithNulls = {
        ...mockRepresentative,
        party: null,
        photoUrl: null,
        bio: null,
        contactInfo: null,
      };
      regionService.getRepresentativesByDistricts.mockResolvedValue([
        repWithNulls,
      ]);

      const result = await resolver.representativesByDistricts(
        undefined,
        'State Senate District 5',
        undefined,
      );

      expect(result[0].party).toBeUndefined();
      expect(result[0].photoUrl).toBeUndefined();
      expect(result[0].bio).toBeUndefined();
      expect(result[0].contactInfo).toBeUndefined();
    });

    it('should return empty array when service returns empty', async () => {
      regionService.getRepresentativesByDistricts.mockResolvedValue([]);

      const result = await resolver.representativesByDistricts();

      expect(result).toEqual([]);
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

      const result = await resolver.committees({ skip: 0, take: 10 });

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

      await resolver.committees({ skip: 0, take: 10 }, 'cal-access');

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

      const result = await resolver.contributions({ skip: 0, take: 10 });

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

      await resolver.contributions(
        { skip: 0, take: 10 },
        'comm-1',
        'cal-access',
      );

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

      const result = await resolver.expenditures({ skip: 0, take: 10 });

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

      await resolver.expenditures(
        { skip: 0, take: 10 },
        'comm-1',
        'cal-access',
      );

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

      const result = await resolver.independentExpenditures({
        skip: 0,
        take: 10,
      });

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
        { skip: 0, take: 10 },
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
          itemsSkipped: 0,
          errors: [],
          syncedAt: new Date(),
        },
        {
          dataType: DataType.MEETINGS,
          itemsProcessed: 5,
          itemsCreated: 3,
          itemsUpdated: 2,
          itemsSkipped: 0,
          errors: [],
          syncedAt: new Date(),
        },
      ];
      regionService.syncAll.mockResolvedValue(mockSyncResults);

      const result = await resolver.syncRegionData();

      expect(result).toHaveLength(2);
      expect(result[0].itemsProcessed).toBe(10);
      expect(regionService.syncAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });

    it('should pass dataTypes filter to syncAll', async () => {
      regionService.syncAll.mockResolvedValue([
        {
          dataType: DataType.PROPOSITIONS,
          itemsProcessed: 3,
          itemsCreated: 3,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: [],
          syncedAt: new Date(),
        },
      ]);

      const result = await resolver.syncRegionData([DataTypeGQL.PROPOSITIONS]);

      expect(result).toHaveLength(1);
      expect(regionService.syncAll).toHaveBeenCalledWith(
        ['propositions'],
        undefined,
        undefined,
      );
    });

    it('should include errors in sync results', async () => {
      const mockSyncResults = [
        {
          dataType: DataType.PROPOSITIONS,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: ['Network error'],
          syncedAt: new Date(),
        },
      ];
      regionService.syncAll.mockResolvedValue(mockSyncResults);

      const result = await resolver.syncRegionData();

      expect(result[0].errors).toContain('Network error');
    });
  });

  // ==========================================
  // Legislative Action queries (issue #665)
  // ==========================================

  describe('representativeActivityStats', () => {
    const mockStats = {
      presentSessionDays: 18,
      totalSessionDays: 22,
      absenceDays: 4,
      amendments: 7,
      committeeHearings: 5,
      committeeReports: 12,
      resolutions: 1,
      votes: 0,
      speeches: 0,
    };

    it('returns stats for the given rep with default 90-day window', async () => {
      regionService.getRepresentativeActivityStats.mockResolvedValue(mockStats);

      const result = await resolver.representativeActivityStats('rep-1');

      expect(regionService.getRepresentativeActivityStats).toHaveBeenCalledWith(
        'rep-1',
        90,
      );
      expect(result.presentSessionDays).toBe(18);
      expect(result.amendments).toBe(7);
    });

    it('passes through a caller-supplied sinceDays window', async () => {
      regionService.getRepresentativeActivityStats.mockResolvedValue(mockStats);

      await resolver.representativeActivityStats('rep-1', 30);

      expect(regionService.getRepresentativeActivityStats).toHaveBeenCalledWith(
        'rep-1',
        30,
      );
    });
  });

  describe('representativeActivity', () => {
    const mockAction = {
      id: 'la-1',
      externalId: 'california-meetings-2026-04-28-0042',
      body: 'Assembly',
      date: new Date('2026-04-28T00:00:00Z'),
      actionType: 'amendment',
      position: null,
      text: "Author's amendments adopted in Committee on Health.",
      passageStart: 12347,
      passageEnd: 12521,
      rawSubject: 'AB 1897',
      representativeId: 'rep-1',
      propositionId: null,
      committeeId: 'cmt-1',
      minutesId: 'min-1',
      minutesExternalId: 'california-meetings-2026-04-28',
    };

    it('returns paginated activity feed for the rep', async () => {
      regionService.getRepresentativeActivity.mockResolvedValue({
        items: [mockAction],
        total: 1,
        hasMore: false,
      });

      const result = await resolver.representativeActivity('rep-1');

      expect(regionService.getRepresentativeActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          representativeId: 'rep-1',
          skip: 0,
          take: 10,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'la-1',
          actionType: 'amendment',
          rawSubject: 'AB 1897',
          minutesExternalId: 'california-meetings-2026-04-28',
          passageStart: 12347,
          passageEnd: 12521,
          // null fields are mapped to undefined for GraphQL nullability:
          position: undefined,
          propositionId: undefined,
        }),
      );
    });

    it('forwards actionTypes + includePresenceYes filters', async () => {
      regionService.getRepresentativeActivity.mockResolvedValue({
        items: [],
        total: 0,
        hasMore: false,
      });

      await resolver.representativeActivity(
        'rep-1',
        ['committee_hearing'],
        true,
        20,
        5,
      );

      expect(regionService.getRepresentativeActivity).toHaveBeenCalledWith({
        representativeId: 'rep-1',
        actionTypes: ['committee_hearing'],
        includePresenceYes: true,
        skip: 20,
        take: 5,
      });
    });
  });

  describe('minutesPassage', () => {
    it('returns the passage for an action with valid offsets', async () => {
      const mockPassage = {
        actionId: 'la-1',
        minutesExternalId: 'california-meetings-2026-04-28',
        body: 'Assembly',
        date: new Date('2026-04-28T00:00:00Z'),
        sourceUrl: 'https://example.com/journal.pdf',
        passageStart: 12347,
        passageEnd: 12521,
        passageText: 'Assembly Bill No. 1897, ...',
        sectionContext: '...preceding context...',
      };
      regionService.getMinutesPassage.mockResolvedValue(mockPassage);

      const result = await resolver.minutesPassage('la-1');

      expect(regionService.getMinutesPassage).toHaveBeenCalledWith('la-1');
      expect(result?.passageText).toBe('Assembly Bill No. 1897, ...');
      expect(result?.minutesExternalId).toBe('california-meetings-2026-04-28');
    });

    it('returns null when the action has no resolvable passage', async () => {
      regionService.getMinutesPassage.mockResolvedValue(null);

      const result = await resolver.minutesPassage('la-missing');
      expect(result).toBeNull();
    });
  });

  describe('committeeActivityStats', () => {
    const mockStats = {
      hearings: 7,
      reports: 43,
      amendments: 41,
      distinctBills: 28,
    };

    it('returns committee stats with default 90-day window', async () => {
      regionService.getCommitteeActivityStats.mockResolvedValue(mockStats);

      const result = await resolver.committeeActivityStats('cmt-1');

      expect(regionService.getCommitteeActivityStats).toHaveBeenCalledWith(
        'cmt-1',
        90,
      );
      expect(result.hearings).toBe(7);
      expect(result.distinctBills).toBe(28);
    });

    it('forwards a caller-supplied sinceDays window', async () => {
      regionService.getCommitteeActivityStats.mockResolvedValue(mockStats);

      await resolver.committeeActivityStats('cmt-1', 30);

      expect(regionService.getCommitteeActivityStats).toHaveBeenCalledWith(
        'cmt-1',
        30,
      );
    });
  });

  describe('committeeActivity', () => {
    const mockAction = {
      id: 'la-1',
      externalId: 'california-meetings-2026-04-28-0042',
      body: 'Assembly',
      date: new Date('2026-04-28T00:00:00Z'),
      actionType: 'committee_report',
      position: null,
      text: 'AB 1897: Do pass.',
      passageStart: 12347,
      passageEnd: 12521,
      rawSubject: 'AB 1897',
      representativeId: null,
      propositionId: null,
      committeeId: 'cmt-1',
      minutesId: 'min-1',
      minutesExternalId: 'california-meetings-2026-04-28',
    };

    it('returns paginated activity feed for the committee', async () => {
      regionService.getCommitteeActivity.mockResolvedValue({
        items: [mockAction],
        total: 1,
        hasMore: false,
      });

      const result = await resolver.committeeActivity('cmt-1');

      expect(regionService.getCommitteeActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          committeeId: 'cmt-1',
          skip: 0,
          take: 10,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'la-1',
          actionType: 'committee_report',
          rawSubject: 'AB 1897',
          committeeId: 'cmt-1',
        }),
      );
    });

    it('forwards actionTypes + pagination args', async () => {
      regionService.getCommitteeActivity.mockResolvedValue({
        items: [],
        total: 0,
        hasMore: false,
      });

      await resolver.committeeActivity('cmt-1', ['committee_hearing'], 20, 5);

      expect(regionService.getCommitteeActivity).toHaveBeenCalledWith({
        committeeId: 'cmt-1',
        actionTypes: ['committee_hearing'],
        skip: 20,
        take: 5,
      });
    });
  });

  // ==========================================
  // legislativeCommittees query — nameFilter (#672)
  // ==========================================

  describe('legislativeCommittees', () => {
    const mockResult = {
      items: [
        {
          id: 'cmt-1',
          externalId: 'assembly:health',
          name: 'Health',
          chamber: 'Assembly',
          url: null,
          description: null,
          memberCount: 10,
        },
      ],
      total: 1,
      hasMore: false,
    };

    it('forwards skip + take + chamber to the service', async () => {
      regionService.listLegislativeCommittees.mockResolvedValue(mockResult);

      await resolver.legislativeCommittees({ skip: 0, take: 10 }, 'Assembly');

      expect(regionService.listLegislativeCommittees).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        chamber: 'Assembly',
        nameFilter: undefined,
      });
    });

    it('forwards a nameFilter substring to the service', async () => {
      regionService.listLegislativeCommittees.mockResolvedValue(mockResult);

      await resolver.legislativeCommittees(
        { skip: 0, take: 200 },
        undefined,
        'Veterans',
      );

      expect(regionService.listLegislativeCommittees).toHaveBeenCalledWith({
        skip: 0,
        take: 200,
        chamber: undefined,
        nameFilter: 'Veterans',
      });
    });
  });
});
