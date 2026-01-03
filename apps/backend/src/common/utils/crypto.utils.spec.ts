import { safeCompare, isNonEmptyString } from './crypto.utils';

/**
 * Tests for constant-time comparison utilities
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/195
 */
describe('Crypto Utils', () => {
  describe('safeCompare', () => {
    describe('equal strings', () => {
      it('should return true for identical strings', () => {
        expect(safeCompare('secret', 'secret')).toBe(true);
      });

      it('should return true for identical empty strings', () => {
        expect(safeCompare('', '')).toBe(true);
      });

      it('should return true for identical long strings', () => {
        const longString = 'a'.repeat(10000);
        expect(safeCompare(longString, longString)).toBe(true);
      });

      it('should return true for identical UUID-like strings', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        expect(safeCompare(uuid, uuid)).toBe(true);
      });

      it('should return true for identical base64 strings', () => {
        const base64 = 'SGVsbG8gV29ybGQh';
        expect(safeCompare(base64, base64)).toBe(true);
      });
    });

    describe('different strings', () => {
      it('should return false for completely different strings', () => {
        expect(safeCompare('secret', 'password')).toBe(false);
      });

      it('should return false for strings differing by one character', () => {
        expect(safeCompare('secret', 'secres')).toBe(false);
      });

      it('should return false for strings differing at the start', () => {
        expect(safeCompare('secret', 'aecret')).toBe(false);
      });

      it('should return false for strings differing at the end', () => {
        expect(safeCompare('secret', 'secrea')).toBe(false);
      });

      it('should return false for strings of different lengths', () => {
        expect(safeCompare('secret', 'secrets')).toBe(false);
        expect(safeCompare('secrets', 'secret')).toBe(false);
      });

      it('should return false for empty vs non-empty string', () => {
        expect(safeCompare('', 'secret')).toBe(false);
        expect(safeCompare('secret', '')).toBe(false);
      });

      it('should return false for case-sensitive differences', () => {
        expect(safeCompare('Secret', 'secret')).toBe(false);
        expect(safeCompare('SECRET', 'secret')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false for null input', () => {
        expect(safeCompare(null as unknown as string, 'secret')).toBe(false);
        expect(safeCompare('secret', null as unknown as string)).toBe(false);
      });

      it('should return false for undefined input', () => {
        expect(safeCompare(undefined as unknown as string, 'secret')).toBe(
          false,
        );
        expect(safeCompare('secret', undefined as unknown as string)).toBe(
          false,
        );
      });

      it('should return false for number input', () => {
        expect(safeCompare(123 as unknown as string, 'secret')).toBe(false);
        expect(safeCompare('123', 123 as unknown as string)).toBe(false);
      });

      it('should return false for object input', () => {
        expect(safeCompare({} as unknown as string, 'secret')).toBe(false);
      });

      it('should return false for array input', () => {
        expect(safeCompare([] as unknown as string, 'secret')).toBe(false);
      });
    });

    describe('special characters', () => {
      it('should handle strings with special characters', () => {
        const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        expect(safeCompare(special, special)).toBe(true);
        expect(safeCompare(special, special + ' ')).toBe(false);
      });

      it('should handle strings with unicode characters', () => {
        const unicode = '你好世界🌍';
        expect(safeCompare(unicode, unicode)).toBe(true);
        expect(safeCompare(unicode, '你好世界')).toBe(false);
      });

      it('should handle strings with newlines and whitespace', () => {
        const withNewline = 'hello\nworld';
        expect(safeCompare(withNewline, withNewline)).toBe(true);
        expect(safeCompare(withNewline, 'hello world')).toBe(false);
      });
    });

    describe('timing attack resistance', () => {
      /**
       * Note: This is a basic sanity check, not a rigorous timing analysis.
       * True timing attack resistance requires statistical analysis of many runs.
       * The purpose here is to verify the function doesn't have obvious early-exit behavior.
       */
      it('should not have dramatically different timing for early vs late differences', () => {
        const base = 'a'.repeat(1000);
        const earlyDiff = 'b' + 'a'.repeat(999);
        const lateDiff = 'a'.repeat(999) + 'b';

        // Run multiple iterations to get more stable timing
        const iterations = 100;

        const startEarly = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
          safeCompare(base, earlyDiff);
        }
        const earlyTime = Number(process.hrtime.bigint() - startEarly);

        const startLate = process.hrtime.bigint();
        for (let i = 0; i < iterations; i++) {
          safeCompare(base, lateDiff);
        }
        const lateTime = Number(process.hrtime.bigint() - startLate);

        // The times should be within the same order of magnitude
        // Allow for significant variance due to system noise
        const ratio =
          Math.max(earlyTime, lateTime) / Math.min(earlyTime, lateTime);
        expect(ratio).toBeLessThan(10); // Very generous threshold for CI stability
      });
    });
  });

  describe('isNonEmptyString', () => {
    it('should return true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString('a')).toBe(true);
      expect(isNonEmptyString(' ')).toBe(true); // whitespace is still non-empty
    });

    it('should return false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isNonEmptyString(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNonEmptyString(undefined)).toBe(false);
    });

    it('should return false for numbers', () => {
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(0)).toBe(false);
    });

    it('should return false for objects', () => {
      expect(isNonEmptyString({})).toBe(false);
      expect(isNonEmptyString({ length: 5 })).toBe(false);
    });

    it('should return false for arrays', () => {
      expect(isNonEmptyString([])).toBe(false);
      expect(isNonEmptyString(['a', 'b'])).toBe(false);
    });
  });
});
