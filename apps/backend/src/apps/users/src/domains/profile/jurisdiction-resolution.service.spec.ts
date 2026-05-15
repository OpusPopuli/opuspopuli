import { Test, TestingModule } from '@nestjs/testing';
import { JurisdictionResolutionService } from './jurisdiction-resolution.service';
import {
  DbService,
  UserAddress,
  Jurisdiction,
} from '@opuspopuli/relationaldb-provider';
import {
  createMockDbClient,
  MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';

describe('JurisdictionResolutionService', () => {
  let service: JurisdictionResolutionService;
  let mockDb: MockDbClient;

  const mockAddress: Partial<UserAddress> = {
    id: 'addr-1',
    userId: 'user-1',
    congressionalDistrict: 'Congressional District 12',
    stateSenatorialDistrict: 'State Senate District 9',
    stateAssemblyDistrict: 'Assembly District 18',
    county: 'Alameda County',
    municipality: 'Oakland city',
    schoolDistrict: 'Oakland Unified School District',
    state: 'CA',
  };

  const mockJurisdictions = [
    { id: 'j-congressional' },
    { id: 'j-senate' },
    { id: 'j-assembly' },
    { id: 'j-county' },
    { id: 'j-city' },
    { id: 'j-school' },
  ] as Jurisdiction[];

  beforeEach(async () => {
    mockDb = createMockDbClient();

    // replaceJurisdictions wraps DELETE+INSERT in a $transaction; execute the
    // callback with mockDb as the transaction client so $executeRaw is tracked.

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JurisdictionResolutionService,
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<JurisdictionResolutionService>(
      JurisdictionResolutionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveForAddress', () => {
    it('should resolve census and postgis jurisdictions and upsert', async () => {
      mockDb.userAddress.findUnique.mockResolvedValue(
        mockAddress as UserAddress,
      );
      mockDb.jurisdiction.findMany.mockResolvedValue(mockJurisdictions);
      mockDb.$queryRaw.mockResolvedValue([
        {
          id: 'j-water',
          name: 'EBMUD',
          type: 'WATER_DISTRICT',
          level: 'DISTRICT',
        },
      ]);
      mockDb.$executeRaw.mockResolvedValue(1);

      await service.resolveForAddress('user-1', 'addr-1', 37.8, -122.2);

      expect(mockDb.userAddress.findUnique).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        select: expect.objectContaining({ congressionalDistrict: true }),
      });
      expect(mockDb.jurisdiction.findMany).toHaveBeenCalled();
      expect(mockDb.$queryRaw).toHaveBeenCalled();
      expect(mockDb.$executeRaw).toHaveBeenCalled();
    });

    it('should mark census-only results as census_geocoder and postgis-only as postgis', async () => {
      mockDb.userAddress.findUnique.mockResolvedValue(
        mockAddress as UserAddress,
      );
      mockDb.jurisdiction.findMany.mockResolvedValue([
        { id: 'j-county' },
      ] as Jurisdiction[]);
      // PostGIS returns a different jurisdiction not in census results
      mockDb.$queryRaw.mockResolvedValue([
        {
          id: 'j-fire',
          name: 'Fire District',
          type: 'FIRE_DISTRICT',
          level: 'DISTRICT',
        },
      ]);
      mockDb.$executeRaw.mockResolvedValue(1);

      await service.resolveForAddress('user-1', 'addr-1', 37.8, -122.2);

      // calls[0] = DELETE, calls[1] = INSERT; JSON rows are the second interpolated value
      const callArgs = mockDb.$executeRaw.mock.calls[1] as unknown[];
      const jsonPayload = callArgs[1] as string;
      const rows = JSON.parse(jsonPayload) as {
        jurisdictionId: string;
        resolvedBy: string;
      }[];

      const countyRow = rows.find((r) => r.jurisdictionId === 'j-county');
      const fireRow = rows.find((r) => r.jurisdictionId === 'j-fire');
      expect(countyRow?.resolvedBy).toBe('census_geocoder');
      expect(fireRow?.resolvedBy).toBe('postgis');
    });

    it('should do nothing when address is not found', async () => {
      mockDb.userAddress.findUnique.mockResolvedValue(null);
      mockDb.$queryRaw.mockResolvedValue([]);

      await service.resolveForAddress('user-1', 'addr-missing', 37.8, -122.2);

      expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    });

    it('should skip upsert when no jurisdictions are resolved', async () => {
      mockDb.userAddress.findUnique.mockResolvedValue({
        ...mockAddress,
        congressionalDistrict: null,
        stateSenatorialDistrict: null,
        stateAssemblyDistrict: null,
        county: null,
        municipality: null,
        schoolDistrict: null,
      } as unknown as UserAddress);
      mockDb.jurisdiction.findMany.mockResolvedValue([]);
      mockDb.$queryRaw.mockResolvedValue([]);

      await service.resolveForAddress('user-1', 'addr-1', 37.8, -122.2);

      expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    });

    it('should proceed with census results when postgis query fails', async () => {
      mockDb.userAddress.findUnique.mockResolvedValue(
        mockAddress as UserAddress,
      );
      mockDb.jurisdiction.findMany.mockResolvedValue([
        { id: 'j-county' },
      ] as Jurisdiction[]);
      mockDb.$queryRaw.mockRejectedValue(new Error('PostGIS unavailable'));
      mockDb.$executeRaw.mockResolvedValue(1);

      await expect(
        service.resolveForAddress('user-1', 'addr-1', 37.8, -122.2),
      ).resolves.not.toThrow();

      // Should still upsert the census-resolved jurisdiction
      expect(mockDb.$executeRaw).toHaveBeenCalled();
    });

    it('should deduplicate when postgis and census return the same jurisdiction', async () => {
      const sharedId = 'j-county';
      mockDb.userAddress.findUnique.mockResolvedValue(
        mockAddress as UserAddress,
      );
      mockDb.jurisdiction.findMany.mockResolvedValue([
        { id: sharedId },
      ] as Jurisdiction[]);
      // PostGIS also returns the same jurisdiction — postgis wins on resolvedBy
      mockDb.$queryRaw.mockResolvedValue([
        {
          id: sharedId,
          name: 'Alameda County',
          type: 'COUNTY',
          level: 'COUNTY',
        },
      ]);
      mockDb.$executeRaw.mockResolvedValue(1);

      await service.resolveForAddress('user-1', 'addr-1', 37.8, -122.2);

      // calls[0] = DELETE, calls[1] = INSERT
      const callArgs = mockDb.$executeRaw.mock.calls[1] as unknown[];
      const jsonPayload = callArgs[1] as string;
      const rows = JSON.parse(jsonPayload) as unknown[];

      // Only one row despite both sources returning the same jurisdiction
      expect(rows).toHaveLength(1);
      expect((rows[0] as { resolvedBy: string }).resolvedBy).toBe('postgis');
    });
  });
});
