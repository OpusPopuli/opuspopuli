import { fuzzLocation, toPostGISPoint, GeoLocation } from './location.dto';

describe('fuzzLocation', () => {
  it('should return a GeoLocation object', () => {
    const result = fuzzLocation(37.7749, -122.4194);

    expect(result).toHaveProperty('latitude');
    expect(result).toHaveProperty('longitude');
    expect(typeof result.latitude).toBe('number');
    expect(typeof result.longitude).toBe('number');
  });

  it('should fuzz location within ~100m radius', () => {
    const originalLat = 37.7749;
    const originalLon = -122.4194;

    // Run multiple times to verify fuzzing stays within bounds
    for (let i = 0; i < 100; i++) {
      const result = fuzzLocation(originalLat, originalLon);

      // ~0.001 degrees ≈ 111 meters, so max deviation should be within this
      const latDiff = Math.abs(result.latitude - originalLat);
      const lonDiff = Math.abs(result.longitude - originalLon);

      expect(latDiff).toBeLessThanOrEqual(0.001);
      expect(lonDiff).toBeLessThanOrEqual(0.001);
    }
  });

  it('should produce different results (randomness)', () => {
    const results: GeoLocation[] = [];

    // Generate multiple fuzzed locations
    for (let i = 0; i < 10; i++) {
      results.push(fuzzLocation(37.7749, -122.4194));
    }

    // Check that not all results are identical (would indicate broken randomness)
    const uniqueLats = new Set(results.map((r) => r.latitude));
    const uniqueLons = new Set(results.map((r) => r.longitude));

    expect(uniqueLats.size).toBeGreaterThan(1);
    expect(uniqueLons.size).toBeGreaterThan(1);
  });

  it('should clamp latitude to valid range [-90, 90]', () => {
    // Near North Pole
    const nearNorthPole = fuzzLocation(89.999, 0);
    expect(nearNorthPole.latitude).toBeLessThanOrEqual(90);
    expect(nearNorthPole.latitude).toBeGreaterThanOrEqual(-90);

    // Near South Pole
    const nearSouthPole = fuzzLocation(-89.999, 0);
    expect(nearSouthPole.latitude).toBeLessThanOrEqual(90);
    expect(nearSouthPole.latitude).toBeGreaterThanOrEqual(-90);
  });

  it('should clamp longitude to valid range [-180, 180]', () => {
    // Near date line (east)
    const nearDateLineEast = fuzzLocation(0, 179.999);
    expect(nearDateLineEast.longitude).toBeLessThanOrEqual(180);
    expect(nearDateLineEast.longitude).toBeGreaterThanOrEqual(-180);

    // Near date line (west)
    const nearDateLineWest = fuzzLocation(0, -179.999);
    expect(nearDateLineWest.longitude).toBeLessThanOrEqual(180);
    expect(nearDateLineWest.longitude).toBeGreaterThanOrEqual(-180);
  });

  it('should handle equator and prime meridian', () => {
    const result = fuzzLocation(0, 0);

    expect(result.latitude).toBeCloseTo(0, 2);
    expect(result.longitude).toBeCloseTo(0, 2);
  });
});

describe('toPostGISPoint', () => {
  it('should generate valid PostGIS POINT SQL', () => {
    const result = toPostGISPoint(37.7749, -122.4194);

    // PostGIS uses POINT(longitude latitude) order
    expect(result).toBe(
      'ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography',
    );
  });

  it('should handle negative coordinates', () => {
    const result = toPostGISPoint(-33.8688, 151.2093); // Sydney

    expect(result).toBe(
      'ST_SetSRID(ST_MakePoint(151.2093, -33.8688), 4326)::geography',
    );
  });

  it('should handle zero coordinates', () => {
    const result = toPostGISPoint(0, 0);

    expect(result).toBe('ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography');
  });
});
