import {
  isPrivateHost,
  normalizeForOcdId,
  substituteOcdId,
  substituteVerbatim,
  validateJurisdictionLevel,
  validateJurisdictionType,
} from './arcgis.utils';

describe('arcgis.utils', () => {
  describe('substituteVerbatim', () => {
    it('replaces a single placeholder', () => {
      expect(
        substituteVerbatim("STATE='${fipsCode}'", { fipsCode: '06' }),
      ).toBe("STATE='06'");
    });

    it('replaces multiple placeholders, preserves order', () => {
      expect(
        substituteVerbatim('${stateCode}-${name}-${district}', {
          stateCode: 'CA',
          name: 'Senate',
          district: '11',
        }),
      ).toBe('CA-Senate-11');
    });

    it('leaves unknown placeholders untouched so typos are visible', () => {
      // Per the helper's contract: undefined keys pass through so the
      // resulting URL fails informatively rather than silently collapsing.
      expect(substituteVerbatim('hello-${unknown}-world', {})).toBe(
        'hello-${unknown}-world',
      );
    });

    it('preserves mixed case + whitespace in ${name}', () => {
      // Verbatim → nameTemplate uses this path; case + whitespace stay
      // as the source published them.
      expect(
        substituteVerbatim('${name} District', { name: 'San   Francisco' }),
      ).toBe('San   Francisco District');
    });

    it('returns the template unchanged when no placeholders match', () => {
      expect(substituteVerbatim('plain text', { name: 'x' })).toBe(
        'plain text',
      );
    });
  });

  describe('substituteOcdId', () => {
    it('normalizes ${name} (lowercase, whitespace→underscore)', () => {
      expect(
        substituteOcdId('/county:${name}', { name: 'Alameda County' }),
      ).toBe('/county:alameda_county');
    });

    it('substitutes ${district} verbatim (no normalization)', () => {
      expect(substituteOcdId('/sldu:${district}', { district: '11' })).toBe(
        '/sldu:11',
      );
    });

    it('substitutes ${fipsCode} and ${stateCode} verbatim', () => {
      expect(
        substituteOcdId('${stateCode}-${fipsCode}', {
          fipsCode: '06',
          stateCode: 'CA',
        }),
      ).toBe('CA-06');
    });

    it('leaves unknown placeholders untouched', () => {
      expect(substituteOcdId('${nope}/x', {})).toBe('${nope}/x');
    });
  });

  describe('normalizeForOcdId', () => {
    it('trims, lowercases, and collapses internal whitespace', () => {
      expect(normalizeForOcdId('  San Francisco  ')).toBe('san_francisco');
      expect(normalizeForOcdId('Los Angeles')).toBe('los_angeles');
    });

    it('collapses multiple whitespace characters to a single underscore', () => {
      expect(normalizeForOcdId('San   Francisco')).toBe('san_francisco');
      expect(normalizeForOcdId('San\tFrancisco')).toBe('san_francisco');
    });

    it('returns empty string for whitespace-only or empty input', () => {
      expect(normalizeForOcdId('')).toBe('');
      expect(normalizeForOcdId('   ')).toBe('');
    });

    it('preserves OCD-ID-safe characters (letters, digits, underscores)', () => {
      expect(normalizeForOcdId('District_42')).toBe('district_42');
    });
  });

  describe('isPrivateHost', () => {
    it('blocks loopback IPv4 and localhost', () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true);
      expect(isPrivateHost('localhost')).toBe(true);
      // Case-insensitive
      expect(isPrivateHost('LOCALHOST')).toBe(true);
    });

    it('blocks RFC1918 ranges', () => {
      expect(isPrivateHost('10.0.0.5')).toBe(true);
      expect(isPrivateHost('192.168.1.1')).toBe(true);
      expect(isPrivateHost('172.16.0.1')).toBe(true);
      expect(isPrivateHost('172.31.255.255')).toBe(true);
      // 172.32+ is NOT private (boundary check)
      expect(isPrivateHost('172.32.0.1')).toBe(false);
      expect(isPrivateHost('172.15.0.1')).toBe(false);
    });

    it('blocks link-local and 0.0.0.0/8', () => {
      expect(isPrivateHost('169.254.169.254')).toBe(true); // AWS metadata
      expect(isPrivateHost('0.0.0.0')).toBe(true);
    });

    it('blocks IPv6 loopback + ULA + link-local', () => {
      expect(isPrivateHost('::1')).toBe(true);
      expect(isPrivateHost('fc00:1::1')).toBe(true); // ULA
      expect(isPrivateHost('fd00:1::1')).toBe(true); // ULA
      expect(isPrivateHost('fe80::1')).toBe(true); // link-local
    });

    it('allows public hostnames', () => {
      expect(isPrivateHost('tigerweb.geo.census.gov')).toBe(false);
      expect(isPrivateHost('services1.arcgis.com')).toBe(false);
      expect(isPrivateHost('gis.water.ca.gov')).toBe(false);
      expect(isPrivateHost('8.8.8.8')).toBe(false);
    });
  });

  describe('validateJurisdictionType', () => {
    it('accepts known Prisma enum values', () => {
      expect(validateJurisdictionType('COUNTY')).toBe('COUNTY');
      expect(validateJurisdictionType('FIRE_DISTRICT')).toBe('FIRE_DISTRICT');
    });

    it('rejects unknown values (drift guard)', () => {
      expect(validateJurisdictionType('LIBRARY_DISTRICT')).toBeNull();
      expect(validateJurisdictionType('')).toBeNull();
      expect(validateJurisdictionType('county')).toBeNull(); // case-sensitive
    });
  });

  describe('validateJurisdictionLevel', () => {
    it('accepts known Prisma enum values', () => {
      expect(validateJurisdictionLevel('COUNTY')).toBe('COUNTY');
      expect(validateJurisdictionLevel('DISTRICT')).toBe('DISTRICT');
    });

    it('rejects unknown values', () => {
      expect(validateJurisdictionLevel('GALACTIC')).toBeNull();
      expect(validateJurisdictionLevel('')).toBeNull();
    });
  });
});
