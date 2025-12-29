import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, UpdateResult } from 'typeorm';
import { createMock } from '@golevelup/ts-jest';

import { RegionDomainService } from './region.service';
import { PropositionEntity } from 'src/db/entities/proposition.entity';
import { MeetingEntity } from 'src/db/entities/meeting.entity';
import { RepresentativeEntity } from 'src/db/entities/representative.entity';
import {
  RegionService as RegionProviderService,
  CivicDataType,
} from '@qckstrt/region-provider';

describe('RegionDomainService', () => {
  let service: RegionDomainService;
  let regionProviderService: jest.Mocked<RegionProviderService>;
  let propositionRepo: jest.Mocked<Repository<PropositionEntity>>;
  let meetingRepo: jest.Mocked<Repository<MeetingEntity>>;
  let representativeRepo: jest.Mocked<Repository<RepresentativeEntity>>;

  const mockRegionInfo = {
    id: 'test-region',
    name: 'Test Region',
    description: 'A test region for testing',
    timezone: 'America/Los_Angeles',
    dataSourceUrls: ['https://example.com'],
  };

  const mockPropositions = [
    {
      externalId: 'prop-1',
      title: 'Test Proposition 1',
      summary: 'Summary 1',
      fullText: 'Full text 1',
      status: 'pending',
      electionDate: new Date('2024-11-05'),
      sourceUrl: 'https://example.com/prop-1',
    },
  ];

  const mockMeetings = [
    {
      externalId: 'meeting-1',
      title: 'City Council Meeting',
      body: 'City Council',
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
      location: 'City Hall',
      agendaUrl: 'https://example.com/agenda',
      videoUrl: 'https://example.com/video',
    },
  ];

  const mockRepresentatives = [
    {
      externalId: 'rep-1',
      name: 'John Doe',
      chamber: 'Senate',
      district: 'District 1',
      party: 'Independent',
      photoUrl: 'https://example.com/photo.jpg',
      contactInfo: { email: 'john@example.com' },
    },
  ];

  beforeEach(async () => {
    const mockRegionProvider = {
      getProviderName: jest.fn().mockReturnValue('test-provider'),
      getRegionInfo: jest.fn().mockReturnValue(mockRegionInfo),
      getSupportedDataTypes: jest
        .fn()
        .mockReturnValue([
          CivicDataType.PROPOSITIONS,
          CivicDataType.MEETINGS,
          CivicDataType.REPRESENTATIVES,
        ]),
      fetchPropositions: jest.fn().mockResolvedValue(mockPropositions),
      fetchMeetings: jest.fn().mockResolvedValue(mockMeetings),
      fetchRepresentatives: jest.fn().mockResolvedValue(mockRepresentatives),
    };

    const mockPropositionRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockMeetingRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockRepresentativeRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        {
          provide: RegionProviderService,
          useValue: mockRegionProvider,
        },
        {
          provide: getRepositoryToken(PropositionEntity),
          useValue: mockPropositionRepo,
        },
        {
          provide: getRepositoryToken(MeetingEntity),
          useValue: mockMeetingRepo,
        },
        {
          provide: getRepositoryToken(RepresentativeEntity),
          useValue: mockRepresentativeRepo,
        },
      ],
    }).compile();

    service = module.get<RegionDomainService>(RegionDomainService);
    regionProviderService = module.get(RegionProviderService);
    propositionRepo = module.get(getRepositoryToken(PropositionEntity));
    meetingRepo = module.get(getRepositoryToken(MeetingEntity));
    representativeRepo = module.get(getRepositoryToken(RepresentativeEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRegionInfo', () => {
    it('should return region info with supported data types', () => {
      const info = service.getRegionInfo();

      expect(info.id).toBe('test-region');
      expect(info.name).toBe('Test Region');
      expect(info.description).toBeDefined();
      expect(info.timezone).toBe('America/Los_Angeles');
      expect(info.supportedDataTypes).toHaveLength(3);
    });
  });

  describe('syncAll', () => {
    it('should sync all data types and return results', async () => {
      propositionRepo.findOne.mockResolvedValue(null);
      propositionRepo.save.mockResolvedValue({} as PropositionEntity);
      meetingRepo.findOne.mockResolvedValue(null);
      meetingRepo.save.mockResolvedValue({} as MeetingEntity);
      representativeRepo.findOne.mockResolvedValue(null);
      representativeRepo.save.mockResolvedValue({} as RepresentativeEntity);

      const results = await service.syncAll();

      expect(results).toHaveLength(3);
      expect(results[0].dataType).toBe(CivicDataType.PROPOSITIONS);
      expect(results[1].dataType).toBe(CivicDataType.MEETINGS);
      expect(results[2].dataType).toBe(CivicDataType.REPRESENTATIVES);
    });

    it('should handle sync errors gracefully', async () => {
      regionProviderService.fetchPropositions.mockRejectedValue(
        new Error('Network error'),
      );
      meetingRepo.findOne.mockResolvedValue(null);
      meetingRepo.save.mockResolvedValue({} as MeetingEntity);
      representativeRepo.findOne.mockResolvedValue(null);
      representativeRepo.save.mockResolvedValue({} as RepresentativeEntity);

      const results = await service.syncAll();

      expect(results[0].errors).toContain('Network error');
      expect(results[0].itemsProcessed).toBe(0);
    });
  });

  describe('syncDataType - PROPOSITIONS', () => {
    it('should create new propositions', async () => {
      propositionRepo.findOne.mockResolvedValue(null);
      propositionRepo.save.mockResolvedValue({} as PropositionEntity);

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(result.itemsProcessed).toBe(1);
      expect(propositionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'prop-1',
          title: 'Test Proposition 1',
        }),
      );
    });

    it('should update existing propositions', async () => {
      const existingProp = { id: 'uuid-1', externalId: 'prop-1' };
      propositionRepo.findOne.mockResolvedValue(
        existingProp as PropositionEntity,
      );
      propositionRepo.update.mockResolvedValue({} as UpdateResult);

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      expect(result.itemsCreated).toBe(0);
      expect(result.itemsUpdated).toBe(1);
      expect(propositionRepo.update).toHaveBeenCalledWith(
        'uuid-1',
        expect.objectContaining({
          title: 'Test Proposition 1',
        }),
      );
    });
  });

  describe('syncDataType - MEETINGS', () => {
    it('should create new meetings', async () => {
      meetingRepo.findOne.mockResolvedValue(null);
      meetingRepo.save.mockResolvedValue({} as MeetingEntity);

      const result = await service.syncDataType(CivicDataType.MEETINGS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(meetingRepo.save).toHaveBeenCalled();
    });

    it('should update existing meetings', async () => {
      const existingMeeting = { id: 'uuid-1', externalId: 'meeting-1' };
      meetingRepo.findOne.mockResolvedValue(existingMeeting as MeetingEntity);
      meetingRepo.update.mockResolvedValue({} as UpdateResult);

      const result = await service.syncDataType(CivicDataType.MEETINGS);

      expect(result.itemsUpdated).toBe(1);
      expect(meetingRepo.update).toHaveBeenCalled();
    });
  });

  describe('syncDataType - REPRESENTATIVES', () => {
    it('should create new representatives', async () => {
      representativeRepo.findOne.mockResolvedValue(null);
      representativeRepo.save.mockResolvedValue({} as RepresentativeEntity);

      const result = await service.syncDataType(CivicDataType.REPRESENTATIVES);

      expect(result.itemsCreated).toBe(1);
      expect(representativeRepo.save).toHaveBeenCalled();
    });

    it('should update existing representatives', async () => {
      const existingRep = { id: 'uuid-1', externalId: 'rep-1' };
      representativeRepo.findOne.mockResolvedValue(
        existingRep as RepresentativeEntity,
      );
      representativeRepo.update.mockResolvedValue({} as UpdateResult);

      const result = await service.syncDataType(CivicDataType.REPRESENTATIVES);

      expect(result.itemsUpdated).toBe(1);
      expect(representativeRepo.update).toHaveBeenCalled();
    });
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
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      propositionRepo.findAndCount.mockResolvedValue([
        mockItems as PropositionEntity[],
        1,
      ]);

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
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      propositionRepo.findAndCount.mockResolvedValue([
        mockItems as PropositionEntity[],
        15,
      ]);

      const result = await service.getPropositions(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getProposition', () => {
    it('should return a single proposition by ID', async () => {
      const mockProp = { id: '1', title: 'Test Prop' };
      propositionRepo.findOne.mockResolvedValue(mockProp as PropositionEntity);

      const result = await service.getProposition('1');

      expect(result).toEqual(mockProp);
      expect(propositionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if proposition not found', async () => {
      propositionRepo.findOne.mockResolvedValue(null);

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
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      meetingRepo.findAndCount.mockResolvedValue([
        mockItems as MeetingEntity[],
        1,
      ]);

      const result = await service.getMeetings(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getMeeting', () => {
    it('should return a single meeting by ID', async () => {
      const mockMeeting = { id: '1', title: 'Test Meeting' };
      meetingRepo.findOne.mockResolvedValue(mockMeeting as MeetingEntity);

      const result = await service.getMeeting('1');

      expect(result).toEqual(mockMeeting);
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
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockQueryBuilder =
        createMock<SelectQueryBuilder<RepresentativeEntity>>();
      mockQueryBuilder.where.mockReturnThis();
      mockQueryBuilder.orderBy.mockReturnThis();
      mockQueryBuilder.addOrderBy.mockReturnThis();
      mockQueryBuilder.skip.mockReturnThis();
      mockQueryBuilder.take.mockReturnThis();
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValue(mockItems);

      representativeRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getRepresentatives(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by chamber when provided', async () => {
      const mockQueryBuilder =
        createMock<SelectQueryBuilder<RepresentativeEntity>>();
      mockQueryBuilder.where.mockReturnThis();
      mockQueryBuilder.orderBy.mockReturnThis();
      mockQueryBuilder.addOrderBy.mockReturnThis();
      mockQueryBuilder.skip.mockReturnThis();
      mockQueryBuilder.take.mockReturnThis();
      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockQueryBuilder.getMany.mockResolvedValue([]);

      representativeRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.getRepresentatives(0, 10, 'Senate');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'rep.chamber = :chamber',
        { chamber: 'Senate' },
      );
    });
  });

  describe('getRepresentative', () => {
    it('should return a single representative by ID', async () => {
      const mockRep = { id: '1', name: 'John Doe' };
      representativeRepo.findOne.mockResolvedValue(
        mockRep as RepresentativeEntity,
      );

      const result = await service.getRepresentative('1');

      expect(result).toEqual(mockRep);
    });
  });
});
