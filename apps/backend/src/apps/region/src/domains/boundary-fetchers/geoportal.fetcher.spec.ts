import { Test, TestingModule } from '@nestjs/testing';
import { GeoportalFetcher } from './geoportal.fetcher';
import type { GeoportalLayerConfig } from '@opuspopuli/region-provider';
import type { RegionContext } from './arcgis.utils';

const realFetch = globalThis.fetch;
const fetchMock = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;

beforeAll(() => {
  globalThis.fetch = fetchMock;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  fetchMock.mockReset();
});

function mockGeoJSONResponse(features: object[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ type: 'FeatureCollection', features }),
  } as unknown as Response;
}

const CA_CTX: RegionContext = { fipsCode: '06', stateCode: 'CA' };
const OCD_PREFIX = 'ocd-division/country:us/state:ca';
const FIRE_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Local_Fire_Districts/FeatureServer/0';

describe('GeoportalFetcher', () => {
  let fetcher: GeoportalFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeoportalFetcher],
    }).compile();
    fetcher = module.get(GeoportalFetcher);
  });

  describe('URL + WHERE construction', () => {
    it('uses the config URL verbatim and the default "1=1" WHERE when not overridden', async () => {
      fetchMock.mockResolvedValueOnce(mockGeoJSONResponse([]));
      const layer: GeoportalLayerConfig = {
        url: FIRE_URL,
        outFields: 'OBJECTID,AGENCY',
        jurisdictionType: 'FIRE_DISTRICT',
        level: 'DISTRICT',
        nameField: 'AGENCY',
      };

      await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      const calledUrl = String(fetchMock.mock.calls[0][0]);
      expect(calledUrl.startsWith(`${FIRE_URL}/query?`)).toBe(true);
      expect(calledUrl).toContain('where=1%3D1');
    });
  });

  describe('feature → BoundaryRow mapping', () => {
    it('builds a row with OCD-ID normalization and a verbatim name', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: { OBJECTID: 1, AGENCY: 'Berkeley Fire Department' },
            geometry: { type: 'Polygon', coordinates: [] },
          },
        ]),
      );
      const layer: GeoportalLayerConfig = {
        url: FIRE_URL,
        outFields: 'OBJECTID,AGENCY',
        jurisdictionType: 'FIRE_DISTRICT',
        level: 'DISTRICT',
        nameField: 'AGENCY',
        ocdIdSegment: '/fire_district:${name}',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Berkeley Fire Department');
      expect(rows[0].ocdId).toBe(
        'ocd-division/country:us/state:ca/fire_district:berkeley_fire_department',
      );
      // No fipsField configured → fipsCode is undefined; loader will use
      // ocdId as the upsert key.
      expect(rows[0].fipsCode).toBeUndefined();
    });

    it('honors fipsField + fipsPrefix when both are configured', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: {
              AGENCYNAME: 'East Bay Municipal Utility District',
              AGENCYID: '42',
            },
            geometry: { type: 'Polygon', coordinates: [] },
          },
        ]),
      );
      const layer: GeoportalLayerConfig = {
        url: 'https://gis.water.ca.gov/arcgis/rest/services/Boundaries/i03_WaterDistricts/FeatureServer/0',
        outFields: 'AGENCYNAME,AGENCYID',
        jurisdictionType: 'WATER_DISTRICT',
        level: 'DISTRICT',
        nameField: 'AGENCYNAME',
        fipsField: 'AGENCYID',
        fipsPrefix: 'ca-water-',
        ocdIdSegment: '/water_district:${name}',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(rows[0].fipsCode).toBe('ca-water-42');
    });
  });

  describe('pagination', () => {
    it('accumulates features across multiple pages and stops on a short page', async () => {
      // First page: full 1000 features. Second page: 1 feature (under the
      // page size threshold) so the loop stops after the second call.
      const fullPage = Array.from({ length: 1000 }, (_, i) => ({
        type: 'Feature',
        properties: { OBJECTID: i + 1, AGENCY: `Agency ${i + 1}` },
        geometry: { type: 'Polygon', coordinates: [] },
      }));
      const shortPage = [
        {
          type: 'Feature',
          properties: { OBJECTID: 1001, AGENCY: 'Agency 1001' },
          geometry: { type: 'Polygon', coordinates: [] },
        },
      ];
      fetchMock
        .mockResolvedValueOnce(mockGeoJSONResponse(fullPage))
        .mockResolvedValueOnce(mockGeoJSONResponse(shortPage));

      const layer: GeoportalLayerConfig = {
        url: FIRE_URL,
        outFields: 'OBJECTID,AGENCY',
        jurisdictionType: 'FIRE_DISTRICT',
        level: 'DISTRICT',
        nameField: 'AGENCY',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(1001);
      // Verify each page's offset was used.
      const page1Url = String(fetchMock.mock.calls[0][0]);
      const page2Url = String(fetchMock.mock.calls[1][0]);
      expect(page1Url).toContain('resultOffset=0');
      expect(page2Url).toContain('resultOffset=1000');
    });
  });

  describe('error handling', () => {
    it('returns empty array (and does not throw) on HTTP error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response);

      const layer: GeoportalLayerConfig = {
        url: FIRE_URL,
        outFields: 'OBJECTID,AGENCY',
        jurisdictionType: 'FIRE_DISTRICT',
        level: 'DISTRICT',
        nameField: 'AGENCY',
      };

      await expect(fetcher.fetch(layer, CA_CTX, OCD_PREFIX)).resolves.toEqual(
        [],
      );
    });

    it('returns empty array when fetch throws on the first page', async () => {
      fetchMock.mockRejectedValueOnce(new Error('AbortError: timeout'));

      const layer: GeoportalLayerConfig = {
        url: FIRE_URL,
        outFields: 'OBJECTID,AGENCY',
        jurisdictionType: 'FIRE_DISTRICT',
        level: 'DISTRICT',
        nameField: 'AGENCY',
      };

      await expect(fetcher.fetch(layer, CA_CTX, OCD_PREFIX)).resolves.toEqual(
        [],
      );
    });
  });
});
