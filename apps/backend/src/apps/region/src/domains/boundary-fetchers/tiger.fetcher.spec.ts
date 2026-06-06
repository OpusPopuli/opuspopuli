import { Test, TestingModule } from '@nestjs/testing';
import { TigerFetcher } from './tiger.fetcher';
import type { TigerLayerConfig } from '@opuspopuli/region-provider';
import type { RegionContext } from './arcgis.utils';

// ---------------------------------------------------------------------------
// Global fetch mock. The fetcher constructs ArcGIS REST URLs and calls
// fetch() directly via the shared `fetchPaginatedGeoJSON` helper — we stub
// `globalThis.fetch` so every test can prescribe a deterministic
// FeatureCollection without going over the network.
// ---------------------------------------------------------------------------
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

/**
 * Build a Response-like object that mirrors the `f=geojson` shape returned
 * by ArcGIS MapServer endpoints. Keep `.ok = true` for the happy path —
 * the error tests override individually.
 */
function mockGeoJSONResponse(features: object[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ type: 'FeatureCollection', features }),
  } as unknown as Response;
}

const CA_CTX: RegionContext = { fipsCode: '06', stateCode: 'CA' };
const OCD_PREFIX = 'ocd-division/country:us/state:ca';

describe('TigerFetcher', () => {
  let fetcher: TigerFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TigerFetcher],
    }).compile();
    fetcher = module.get(TigerFetcher);
  });

  describe('URL + WHERE construction', () => {
    it('uses the default WHERE clause and TIGER base URL when the layer omits where', async () => {
      fetchMock.mockResolvedValueOnce(mockGeoJSONResponse([]));
      const layer: TigerLayerConfig = {
        layer: 'State_County/MapServer/1',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
      };

      await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchMock.mock.calls[0][0]);
      expect(calledUrl).toContain(
        'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query',
      );
      // The default WHERE is `STATE='${fipsCode}'`, URL-encoded to STATE%3D%2706%27
      expect(calledUrl).toContain('where=STATE%3D%2706%27');
      expect(calledUrl).toContain('outFields=GEOID%2CNAME');
      expect(calledUrl).toContain('f=geojson');
    });

    it('substitutes ${stateCode} when used in a layer-specified WHERE', async () => {
      fetchMock.mockResolvedValueOnce(mockGeoJSONResponse([]));
      const layer: TigerLayerConfig = {
        layer: 'X/MapServer/0',
        where: "STATEABV='${stateCode}'",
        outFields: 'NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
      };

      await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      const calledUrl = String(fetchMock.mock.calls[0][0]);
      expect(calledUrl).toContain('where=STATEABV%3D%27CA%27');
    });
  });

  describe('feature → BoundaryRow mapping', () => {
    it('builds a row with the default fipsField (GEOID) and the verbatim NAME for counties', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: { GEOID: '06001', NAME: 'Alameda County' },
            geometry: { type: 'Polygon', coordinates: [] },
          },
        ]),
      );
      const layer: TigerLayerConfig = {
        layer: 'State_County/MapServer/1',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
        ocdIdSegment: '/county:${name}',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        name: 'Alameda County', // verbatim — no nameTemplate
        type: 'COUNTY',
        level: 'COUNTY',
        stateCode: 'CA',
        fipsCode: '06001',
        ocdId: 'ocd-division/country:us/state:ca/county:alameda_county',
        geometryGeoJSON: { type: 'Polygon', coordinates: [] },
      });
    });

    it('applies the fipsPrefix when configured (state senate districts)', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: { GEOID: '06001', SLDUST: '011' },
            geometry: { type: 'Polygon', coordinates: [] },
          },
        ]),
      );
      const layer: TigerLayerConfig = {
        layer: 'Legislative/MapServer/1',
        outFields: 'GEOID,SLDUST',
        jurisdictionType: 'STATE_SENATE_DISTRICT',
        level: 'STATE',
        nameField: 'SLDUST',
        fipsPrefix: 'sldu-',
        districtField: 'SLDUST',
        ocdIdSegment: '/sldu:${district}',
        nameTemplate: 'California State Senate District ${district}',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(rows[0].fipsCode).toBe('sldu-06001');
      // districtField stripped leading zeros: '011' → '11'
      expect(rows[0].name).toBe('California State Senate District 11');
      expect(rows[0].ocdId).toBe('ocd-division/country:us/state:ca/sldu:11');
    });

    it('keeps the OCD-ID name segment normalized (whitespace→underscore, lowercased)', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: { GEOID: '06037', NAME: 'San   Francisco' },
            geometry: { type: 'Polygon', coordinates: [] },
          },
        ]),
      );
      const layer: TigerLayerConfig = {
        layer: 'Places_CouSub_ConCity_SubMCD/MapServer/4',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'CITY',
        level: 'MUNICIPAL',
        nameField: 'NAME',
        ocdIdSegment: '/place:${name}',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      // Multiple whitespace collapses to a single underscore, lowercased.
      expect(rows[0].ocdId).toBe(
        'ocd-division/country:us/state:ca/place:san_francisco',
      );
      // nameTemplate omitted → name verbatim.
      expect(rows[0].name).toBe('San   Francisco');
    });

    it('skips features missing the nameField', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: { GEOID: '06001' /* no NAME */ },
            geometry: { type: 'Polygon', coordinates: [] },
          },
          {
            type: 'Feature',
            properties: { GEOID: '06013', NAME: 'Contra Costa County' },
            geometry: { type: 'Polygon', coordinates: [] },
          },
        ]),
      );
      const layer: TigerLayerConfig = {
        layer: 'State_County/MapServer/1',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Contra Costa County');
    });

    it('skips features with no geometry', async () => {
      fetchMock.mockResolvedValueOnce(
        mockGeoJSONResponse([
          {
            type: 'Feature',
            properties: { GEOID: '06001', NAME: 'Alameda County' },
            geometry: null,
          },
        ]),
      );
      const layer: TigerLayerConfig = {
        layer: 'State_County/MapServer/1',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
      };

      const rows = await fetcher.fetch(layer, CA_CTX, OCD_PREFIX);

      expect(rows).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('returns empty array (and does not throw) when TIGER returns HTTP 500', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response);

      const layer: TigerLayerConfig = {
        layer: 'X/MapServer/0',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
      };

      await expect(fetcher.fetch(layer, CA_CTX, OCD_PREFIX)).resolves.toEqual(
        [],
      );
    });

    it('returns empty array when fetch throws (network error / timeout)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

      const layer: TigerLayerConfig = {
        layer: 'X/MapServer/0',
        outFields: 'GEOID,NAME',
        jurisdictionType: 'COUNTY',
        level: 'COUNTY',
        nameField: 'NAME',
      };

      await expect(fetcher.fetch(layer, CA_CTX, OCD_PREFIX)).resolves.toEqual(
        [],
      );
    });
  });
});
