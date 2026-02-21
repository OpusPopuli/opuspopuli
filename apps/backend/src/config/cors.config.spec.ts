import { ConfigService } from '@nestjs/config';
import {
  getCorsConfig,
  getGraphQLCorsConfig,
  parseAllowedOrigins,
  isValidProductionOrigin,
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_MAX_AGE,
} from './cors.config';

describe('CORS Configuration', () => {
  let mockConfigService: jest.Mocked<ConfigService>;

  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Constants', () => {
    it('should have correct allowed headers', () => {
      expect(CORS_ALLOWED_HEADERS).toContain('Content-Type');
      expect(CORS_ALLOWED_HEADERS).toContain('Authorization');
      expect(CORS_ALLOWED_HEADERS).toContain('X-Requested-With');
      expect(CORS_ALLOWED_HEADERS).toContain('X-CSRF-Token');
    });

    it('should have correct allowed methods', () => {
      expect(CORS_ALLOWED_METHODS).toContain('GET');
      expect(CORS_ALLOWED_METHODS).toContain('POST');
      expect(CORS_ALLOWED_METHODS).toContain('OPTIONS');
    });

    it('should have correct max age (24 hours)', () => {
      expect(CORS_MAX_AGE).toBe(86400);
    });
  });

  describe('isValidProductionOrigin', () => {
    it('should accept HTTPS origins', () => {
      expect(isValidProductionOrigin('https://app.example.com')).toBe(true);
      expect(isValidProductionOrigin('https://example.com')).toBe(true);
      expect(isValidProductionOrigin('https://sub.domain.example.com')).toBe(
        true,
      );
    });

    it('should reject HTTP origins', () => {
      expect(isValidProductionOrigin('http://app.example.com')).toBe(false);
      expect(isValidProductionOrigin('http://localhost:3000')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isValidProductionOrigin('not-a-url')).toBe(false);
      expect(isValidProductionOrigin('')).toBe(false);
      expect(isValidProductionOrigin('ftp://example.com')).toBe(false);
    });
  });

  describe('parseAllowedOrigins', () => {
    describe('in development mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
      });

      it('should return null when ALLOWED_ORIGINS is unset', () => {
        mockConfigService.get.mockReturnValue(undefined);
        expect(parseAllowedOrigins(mockConfigService)).toBeNull();
      });

      it('should return parsed origins when ALLOWED_ORIGINS is set', () => {
        mockConfigService.get.mockReturnValue(
          'http://localhost:3000,http://localhost:3200',
        );
        expect(parseAllowedOrigins(mockConfigService)).toEqual([
          'http://localhost:3000',
          'http://localhost:3200',
        ]);
      });
    });

    describe('in production mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      it('should throw if ALLOWED_ORIGINS is unset', () => {
        mockConfigService.get.mockReturnValue(undefined);
        expect(() => parseAllowedOrigins(mockConfigService)).toThrow(
          'ALLOWED_ORIGINS must be set in production',
        );
      });

      it('should throw if ALLOWED_ORIGINS is empty string', () => {
        mockConfigService.get.mockReturnValue('');
        expect(() => parseAllowedOrigins(mockConfigService)).toThrow(
          'ALLOWED_ORIGINS must be set in production',
        );
      });

      it('should throw if ALLOWED_ORIGINS contains only whitespace', () => {
        mockConfigService.get.mockReturnValue('   ');
        expect(() => parseAllowedOrigins(mockConfigService)).toThrow(
          'ALLOWED_ORIGINS must be set in production',
        );
      });

      it('should throw if ALLOWED_ORIGINS contains only commas', () => {
        mockConfigService.get.mockReturnValue(',,,');
        expect(() => parseAllowedOrigins(mockConfigService)).toThrow(
          'ALLOWED_ORIGINS must contain at least one valid origin',
        );
      });

      it('should throw if any origin is not HTTPS', () => {
        mockConfigService.get.mockReturnValue(
          'https://app.example.com,http://admin.example.com',
        );
        expect(() => parseAllowedOrigins(mockConfigService)).toThrow(
          'Invalid origins in ALLOWED_ORIGINS: http://admin.example.com',
        );
      });

      it('should throw if origin is not a valid URL', () => {
        mockConfigService.get.mockReturnValue('not-a-url');
        expect(() => parseAllowedOrigins(mockConfigService)).toThrow(
          'Invalid origins in ALLOWED_ORIGINS: not-a-url',
        );
      });

      it('should return valid HTTPS origins', () => {
        mockConfigService.get.mockReturnValue(
          'https://app.example.com,https://admin.example.com',
        );
        expect(parseAllowedOrigins(mockConfigService)).toEqual([
          'https://app.example.com',
          'https://admin.example.com',
        ]);
      });

      it('should trim whitespace from origins', () => {
        mockConfigService.get.mockReturnValue(
          '  https://app.example.com  ,  https://admin.example.com  ',
        );
        expect(parseAllowedOrigins(mockConfigService)).toEqual([
          'https://app.example.com',
          'https://admin.example.com',
        ]);
      });

      it('should filter out empty entries from trailing commas', () => {
        mockConfigService.get.mockReturnValue(
          'https://app.example.com,,https://admin.example.com,',
        );
        expect(parseAllowedOrigins(mockConfigService)).toEqual([
          'https://app.example.com',
          'https://admin.example.com',
        ]);
      });
    });
  });

  describe('getCorsConfig', () => {
    describe('in development mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
        mockConfigService.get.mockReturnValue(undefined);
      });

      it('should allow all origins', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.origin).toBe(true);
      });

      it('should include credentials', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.credentials).toBe(true);
      });

      it('should use standard allowed methods', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.methods).toEqual(CORS_ALLOWED_METHODS);
      });

      it('should use standard allowed headers', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
      });
    });

    describe('in development mode with ALLOWED_ORIGINS set', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
        mockConfigService.get.mockReturnValue(
          'http://localhost:3000,http://localhost:3200',
        );
      });

      it('should use callback-based origin validation', () => {
        const config = getCorsConfig(mockConfigService);
        expect(typeof config.origin).toBe('function');
      });

      it('should allow listed origins', () => {
        const config = getCorsConfig(mockConfigService);
        const originFn = config.origin as (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) => void;
        const callback = jest.fn();
        originFn('http://localhost:3000', callback);
        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should reject unlisted origins', () => {
        const config = getCorsConfig(mockConfigService);
        const originFn = config.origin as (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) => void;
        const callback = jest.fn();
        originFn('http://evil.com', callback);
        expect(callback).toHaveBeenCalledWith(expect.any(Error));
      });
    });

    describe('in production mode', () => {
      const allowedOrigins =
        'https://app.example.com,https://admin.example.com';

      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        mockConfigService.get.mockReturnValue(allowedOrigins);
      });

      it('should use callback-based origin validation', () => {
        const config = getCorsConfig(mockConfigService);
        expect(typeof config.origin).toBe('function');
      });

      it('should allow listed origins via callback', () => {
        const config = getCorsConfig(mockConfigService);
        const originFn = config.origin as (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) => void;
        const callback = jest.fn();

        originFn('https://app.example.com', callback);
        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should reject unlisted origins via callback', () => {
        const config = getCorsConfig(mockConfigService);
        const originFn = config.origin as (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) => void;
        const callback = jest.fn();

        originFn('https://evil.example.com', callback);
        expect(callback).toHaveBeenCalledWith(expect.any(Error));
      });

      it('should allow requests with no origin (server-to-server)', () => {
        const config = getCorsConfig(mockConfigService);
        const originFn = config.origin as (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) => void;
        const callback = jest.fn();

        originFn(undefined, callback);
        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should include credentials', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.credentials).toBe(true);
      });

      it('should use standard allowed methods', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.methods).toEqual(CORS_ALLOWED_METHODS);
      });

      it('should use standard allowed headers', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
      });

      it('should set maxAge for preflight caching', () => {
        const config = getCorsConfig(mockConfigService);
        expect(config.maxAge).toBe(CORS_MAX_AGE);
      });
    });

    describe('in production without ALLOWED_ORIGINS', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        mockConfigService.get.mockReturnValue(undefined);
      });

      it('should throw an error', () => {
        expect(() => getCorsConfig(mockConfigService)).toThrow(
          'ALLOWED_ORIGINS must be set in production',
        );
      });
    });
  });

  describe('getGraphQLCorsConfig', () => {
    describe('in development mode', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
        mockConfigService.get.mockReturnValue(undefined);
      });

      it('should allow all origins', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.origin).toBe(true);
      });

      it('should include credentials', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.credentials).toBe(true);
      });

      it('should use standard allowed methods', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.methods).toEqual(CORS_ALLOWED_METHODS);
      });

      it('should use standard allowed headers', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
      });
    });

    describe('in production mode', () => {
      const allowedOrigins =
        'https://app.example.com,https://admin.example.com';

      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        mockConfigService.get.mockReturnValue(allowedOrigins);
      });

      it('should restrict to allowed origins', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.origin).toEqual([
          'https://app.example.com',
          'https://admin.example.com',
        ]);
      });

      it('should include credentials', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.credentials).toBe(true);
      });

      it('should use standard allowed methods', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.methods).toEqual(CORS_ALLOWED_METHODS);
      });

      it('should use standard allowed headers', () => {
        const config = getGraphQLCorsConfig(mockConfigService);
        expect(config.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
      });
    });

    describe('in production without ALLOWED_ORIGINS', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
        mockConfigService.get.mockReturnValue(undefined);
      });

      it('should throw an error', () => {
        expect(() => getGraphQLCorsConfig(mockConfigService)).toThrow(
          'ALLOWED_ORIGINS must be set in production',
        );
      });
    });
  });
});
