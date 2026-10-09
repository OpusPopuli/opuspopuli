import {
  GeocodingService,
  GeocoderUnavailableError,
} from './geocoding.service';

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
      expect(result!.schoolDistrict).toBeUndefined();
      expect(result!.timezone).toBe('America/Los_Angeles');

      jest.restoreAllMocks();
    });

    it('should extract unified school district when present', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              addressMatches: [
                {
                  coordinates: { x: -122.2, y: 37.8 },
                  matchedAddress: '1000 Broadway, Oakland, CA, 94607',
                  geographies: {
                    '119th Congressional Districts': [
                      { NAME: 'Congressional District 12' },
                    ],
                    Counties: [{ NAME: 'Alameda County' }],
                    'Incorporated Places': [{ NAME: 'Oakland city' }],
                    'Unified School Districts': [
                      { NAME: 'Oakland Unified School District' },
                    ],
                  },
                },
              ],
            },
          }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      const result = await service.geocode(
        '1000 Broadway',
        'Oakland',
        'CA',
        '94607',
      );

      expect(result!.schoolDistrict).toBe('Oakland Unified School District');
      jest.restoreAllMocks();
    });

    it('should fall back to elementary school district when unified is absent', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              addressMatches: [
                {
                  coordinates: { x: -121.0, y: 37.5 },
                  matchedAddress: '1 Main St, Anywhere, CA, 95000',
                  geographies: {
                    'Elementary School Districts': [
                      { NAME: 'Anywhere Elementary District' },
                    ],
                  },
                },
              ],
            },
          }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      const result = await service.geocode(
        '1 Main St',
        'Anywhere',
        'CA',
        '95000',
      );

      expect(result!.schoolDistrict).toBe('Anywhere Elementary District');
      jest.restoreAllMocks();
    });

    // Throws rather than returning null, and the distinction is load-bearing:
    // null means "the geocoder says no such address", which the caller turns
    // into a 400 telling the user to correct it. A network failure is not that
    // -- we never got an answer -- so it must not be reported as a verdict on
    // the address.
    it('throws GeocoderUnavailableError when fetch fails', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      await expect(
        service.geocode('123 Main St', 'Anytown', 'CA', '90210'),
      ).rejects.toThrow(GeocoderUnavailableError);

      jest.restoreAllMocks();
    });

    it('throws GeocoderUnavailableError when the API returns non-200', async () => {
      const mockResponse = { ok: false, status: 500, statusText: 'Error' };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      await expect(
        service.geocode('123 Main St', 'Anytown', 'CA', '90210'),
      ).rejects.toThrow(GeocoderUnavailableError);

      jest.restoreAllMocks();
    });

    // The other half of the contract: a 200 with zero matches IS a verdict --
    // the address does not exist -- and must stay null so the caller can tell
    // the user to correct it.
    it('returns null when the geocoder finds no match', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ result: { addressMatches: [] } }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

      await expect(
        service.geocode('101 Main Steet', 'Los Angeles', 'CA', '90210'),
      ).resolves.toBeNull();

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

  /**
   * Guard against a resident street address reaching the log pipeline.
   *
   * The #1094 audit fixed two of the three log lines in this file and missed
   * the catch block, which interpolated `addressLine1` at `warn` — a level
   * production emits. These tests drive the real code paths with a
   * recognisable address and assert it does not appear in anything logged,
   * rather than asserting on the source text, so a future rewrite that
   * reintroduces the leak by another route still fails.
   *
   * Verified by reintroducing each leak: restoring `${addressLine1}` to the
   * warn, or passing the raw upstream message to GeocoderUnavailableError,
   * fails these.
   */
  describe('never logs the street address', () => {
    const ADDRESS = '645 Taraval Street';
    const ZIP = '94116';

    let logged: string[];

    beforeEach(() => {
      logged = [];
      for (const level of [
        'log',
        'warn',
        'error',
        'debug',
        'verbose',
      ] as const) {
        jest
          .spyOn(service['logger'], level)
          .mockImplementation((...args: unknown[]) => {
            logged.push(args.map((a) => String(a)).join(' '));
          });
      }
    });

    afterEach(() => jest.restoreAllMocks());

    const expectNoAddressLogged = (): void => {
      const all = logged.join('\n');
      expect(all).not.toContain(ADDRESS);
      expect(all).not.toContain('Taraval');
      expect(all).not.toContain(ZIP);
    };

    it('keeps it out of the logs when the geocoder returns non-OK', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 503 } as Response);

      await expect(
        service.geocode(ADDRESS, 'San Francisco', 'CA', ZIP),
      ).rejects.toThrow(GeocoderUnavailableError);

      expectNoAddressLogged();
      // Locality is kept: it distinguishes a systemic outage from one bad
      // address, and a city is not directly identifying.
      expect(logged.join('\n')).toContain('San Francisco');
    });

    it('keeps it out of the logs when the geocoder finds no match', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { addressMatches: [] } }),
      } as Response);

      await expect(
        service.geocode(ADDRESS, 'San Francisco', 'CA', ZIP),
      ).resolves.toBeNull();

      expectNoAddressLogged();
    });

    it('keeps it out of the logs when the request itself fails', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(
        service.geocode(ADDRESS, 'San Francisco', 'CA', ZIP),
      ).rejects.toThrow(GeocoderUnavailableError);

      expectNoAddressLogged();
    });

    /**
     * We put the street into the request URL as a query parameter, so an error
     * raised by the HTTP layer can carry it back to us inside a message we did
     * not write. Exact-value scrubbing covers the encoded forms too, which a
     * street-address regex would miss entirely: `645+Taraval+Street` has no
     * spaces for a pattern to anchor on.
     */
    it('scrubs the address out of an upstream message that echoes the URL', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(
          new Error(
            'request to https://geocoding.geo.census.gov/x?street=645+Taraval+Street&zip=94116 failed',
          ),
        );

      await expect(
        service.geocode(ADDRESS, 'San Francisco', 'CA', ZIP),
      ).rejects.toThrow(GeocoderUnavailableError);

      expectNoAddressLogged();
    });

    /**
     * Callers log this error's message — profile.service does, on both the
     * create and the edit path. Scrubbing at the one place that still holds
     * the raw values is what makes those callers safe without each of them
     * having to remember.
     */
    it('scrubs the address out of the error it throws, not just its own logs', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(
          new Error(
            'connect ECONNREFUSED while fetching ?street=645+Taraval+Street',
          ),
        );

      let caught: Error | undefined;
      try {
        await service.geocode(ADDRESS, 'San Francisco', 'CA', ZIP);
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).toBeInstanceOf(GeocoderUnavailableError);
      expect(caught?.message).not.toContain('Taraval');
      expect(caught?.message).toContain('[REDACTED]');
    });
  });
});
