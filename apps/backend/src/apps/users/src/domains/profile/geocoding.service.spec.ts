import { GeocodingService } from './geocoding.service';

describe('GeocodingService', () => {
  let service: GeocodingService;

  beforeEach(() => {
    service = new GeocodingService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('geocode', () => {
    it('should return null when Census API returns no matches', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            result: { addressMatches: [] },
          }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      const result = await service.geocode(
        '999 Nonexistent St',
        'Nowhere',
        'XX',
        '00000',
      );

      expect(result).toBeNull();
      jest.restoreAllMocks();
    });

    it('should return geocoding result with coordinates and districts', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              addressMatches: [
                {
                  coordinates: { x: -121.495, y: 38.574 },
                  matchedAddress: '1021 O ST, SACRAMENTO, CA, 95814',
                  geographies: {
                    '119th Congressional Districts': [
                      { NAME: 'Congressional District 7' },
                    ],
                    '2024 State Legislative Districts - Upper': [
                      { NAME: 'State Senate District 8' },
                    ],
                    '2024 State Legislative Districts - Lower': [
                      { NAME: 'Assembly District 6' },
                    ],
                    Counties: [{ NAME: 'Sacramento County' }],
                    'Incorporated Places': [{ NAME: 'Sacramento city' }],
                  },
                },
              ],
            },
          }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      const result = await service.geocode(
        '1021 O Street',
        'Sacramento',
        'CA',
        '95814',
      );

      expect(result).not.toBeNull();
      expect(result!.latitude).toBe(38.574);
      expect(result!.longitude).toBe(-121.495);
      expect(result!.formattedAddress).toBe('1021 O ST, SACRAMENTO, CA, 95814');
      expect(result!.congressionalDistrict).toBe('Congressional District 7');
      expect(result!.stateSenatorialDistrict).toBe('State Senate District 8');
      expect(result!.stateAssemblyDistrict).toBe('Assembly District 6');
      expect(result!.county).toBe('Sacramento County');
      expect(result!.municipality).toBe('Sacramento city');
      expect(result!.timezone).toBe('America/Los_Angeles');

      jest.restoreAllMocks();
    });

    it('should return null when fetch fails', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await service.geocode(
        '123 Main St',
        'Anytown',
        'CA',
        '90210',
      );

      expect(result).toBeNull();
      jest.restoreAllMocks();
    });

    it('should return null when API returns non-200', async () => {
      const mockResponse = { ok: false, status: 500, statusText: 'Error' };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      const result = await service.geocode(
        '123 Main St',
        'Anytown',
        'CA',
        '90210',
      );

      expect(result).toBeNull();
      jest.restoreAllMocks();
    });

    it('should derive correct timezone from longitude', async () => {
      const makeMatch = (lng: number) => ({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              addressMatches: [
                {
                  coordinates: { x: lng, y: 40 },
                  matchedAddress: 'Test',
                  geographies: {},
                },
              ],
            },
          }),
      });

      // Eastern
      jest.spyOn(global, 'fetch').mockResolvedValue(makeMatch(-74) as Response);
      let result = await service.geocode('a', 'b', 'c', 'd');
      expect(result!.timezone).toBe('America/New_York');
      jest.restoreAllMocks();

      // Central
      jest.spyOn(global, 'fetch').mockResolvedValue(makeMatch(-90) as Response);
      result = await service.geocode('a', 'b', 'c', 'd');
      expect(result!.timezone).toBe('America/Chicago');
      jest.restoreAllMocks();

      // Mountain
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(makeMatch(-105) as Response);
      result = await service.geocode('a', 'b', 'c', 'd');
      expect(result!.timezone).toBe('America/Denver');
      jest.restoreAllMocks();

      // Pacific
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(makeMatch(-120) as Response);
      result = await service.geocode('a', 'b', 'c', 'd');
      expect(result!.timezone).toBe('America/Los_Angeles');
      jest.restoreAllMocks();
    });
  });
});
