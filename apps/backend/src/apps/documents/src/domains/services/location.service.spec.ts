import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { LocationService } from './location.service';

// Mock fuzzLocation
jest.mock('../dto/location.dto', () => ({
  ...jest.requireActual('../dto/location.dto'),
  fuzzLocation: jest.fn().mockImplementation((lat: number, lng: number) => ({
    latitude: lat + 0.001,
    longitude: lng + 0.001,
  })),
}));

describe('LocationService', () => {
  let service: LocationService;
  let db: {
    document: {
      findFirst: jest.Mock;
    };
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    $queryRawUnsafe: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      document: {
        findFirst: jest.fn(),
      },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [LocationService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get<LocationService>(LocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setDocumentLocation', () => {
    it('should set fuzzed location for a document', async () => {
      db.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
      });
      db.$executeRaw.mockResolvedValue(1);

      const result = await service.setDocumentLocation(
        'user-1',
        'doc-1',
        37.7749,
        -122.4194,
      );

      expect(result.success).toBe(true);
      expect(result.fuzzedLocation).toBeDefined();
      expect(db.$executeRaw).toHaveBeenCalled();
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.setDocumentLocation(
          'user-1',
          'nonexistent',
          37.7749,
          -122.4194,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocumentLocation', () => {
    it('should return location when exists', async () => {
      db.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
      });
      db.$queryRaw.mockResolvedValue([
        { latitude: 37.775, longitude: -122.419 },
      ]);

      const result = await service.getDocumentLocation('user-1', 'doc-1');

      expect(result).toEqual({ latitude: 37.775, longitude: -122.419 });
    });

    it('should return null when no location set', async () => {
      db.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        userId: 'user-1',
      });
      db.$queryRaw.mockResolvedValue([]);

      const result = await service.getDocumentLocation('user-1', 'doc-1');

      expect(result).toBeNull();
    });

    it('should throw NotFoundException when document not found', async () => {
      db.document.findFirst.mockResolvedValue(null);

      await expect(
        service.getDocumentLocation('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPetitionMapLocations', () => {
    it('should return map markers', async () => {
      db.$queryRawUnsafe.mockResolvedValue([
        {
          id: 'doc-1',
          latitude: 37.775,
          longitude: -122.419,
          document_type: 'petition',
          created_at: new Date('2024-01-01'),
        },
      ]);

      const result = await service.getPetitionMapLocations();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-1');
      expect(result[0].latitude).toBe(37.775);
      expect(result[0].documentType).toBe('petition');
    });

    it('should return empty array when no locations', async () => {
      db.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.getPetitionMapLocations();

      expect(result).toEqual([]);
    });

    it('should apply filters when provided', async () => {
      db.$queryRawUnsafe.mockResolvedValue([]);

      await service.getPetitionMapLocations({
        documentType: 'petition',
        startDate: new Date('2024-01-01'),
      });

      expect(db.$queryRawUnsafe).toHaveBeenCalled();
      const query = db.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(query).toContain('type = $');
      expect(query).toContain('created_at >= $');
    });
  });

  describe('getPetitionMapStats', () => {
    it('should return aggregated stats', async () => {
      db.$queryRaw.mockResolvedValue([
        {
          total_petitions: BigInt(100),
          total_with_location: BigInt(50),
          recent_petitions: BigInt(10),
        },
      ]);

      const result = await service.getPetitionMapStats();

      expect(result).toEqual({
        totalPetitions: 100,
        totalWithLocation: 50,
        recentPetitions: 10,
      });
    });

    it('should handle empty results gracefully', async () => {
      db.$queryRaw.mockResolvedValue([
        {
          total_petitions: BigInt(0),
          total_with_location: BigInt(0),
          recent_petitions: BigInt(0),
        },
      ]);

      const result = await service.getPetitionMapStats();

      expect(result.totalPetitions).toBe(0);
    });
  });

  describe('findDocumentsNearLocation', () => {
    it('should return nearby documents', async () => {
      db.$queryRaw.mockResolvedValue([
        { id: 'doc-1', distance_meters: 500 },
        { id: 'doc-2', distance_meters: 1200 },
      ]);

      const result = await service.findDocumentsNearLocation(
        'hash-123',
        37.7749,
        -122.4194,
      );

      expect(result).toHaveLength(2);
      expect(result[0].documentId).toBe('doc-1');
      expect(result[0].distanceMeters).toBe(500);
    });

    it('should return empty array when no nearby documents', async () => {
      db.$queryRaw.mockResolvedValue([]);

      const result = await service.findDocumentsNearLocation(
        'hash-123',
        37.7749,
        -122.4194,
        5000,
      );

      expect(result).toEqual([]);
    });
  });
});
