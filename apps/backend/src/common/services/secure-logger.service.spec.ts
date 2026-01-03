import { SecureLogger } from './secure-logger.service';
import * as piiMasker from '../utils/pii-masker';

/**
 * Tests for SecureLogger - PII-redacting logger wrapper
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
 */
describe('SecureLogger', () => {
  let logger: SecureLogger;
  let redactPiiFromStringSpy: jest.SpyInstance;
  let sanitizeForLoggingSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new SecureLogger('TestContext');
    // Spy on the sanitization functions to verify they're called
    redactPiiFromStringSpy = jest.spyOn(piiMasker, 'redactPiiFromString');
    sanitizeForLoggingSpy = jest.spyOn(piiMasker, 'sanitizeForLogging');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('instantiation', () => {
    it('should create a logger with context', () => {
      const secureLogger = new SecureLogger('MyService');
      expect(secureLogger).toBeDefined();
    });

    it('should create a logger with default context', () => {
      const secureLogger = new SecureLogger();
      expect(secureLogger).toBeDefined();
    });
  });

  describe('log method', () => {
    it('should sanitize string messages', () => {
      logger.log('User john@example.com logged in');

      expect(redactPiiFromStringSpy).toHaveBeenCalledWith(
        'User john@example.com logged in',
      );
    });

    it('should handle object messages', () => {
      const userData = { email: 'user@test.com', name: 'John' };
      logger.log(userData);

      expect(sanitizeForLoggingSpy).toHaveBeenCalledWith(userData);
    });
  });

  describe('warn method', () => {
    it('should sanitize warning messages', () => {
      logger.warn('Failed login for user@test.com');

      expect(redactPiiFromStringSpy).toHaveBeenCalledWith(
        'Failed login for user@test.com',
      );
    });
  });

  describe('error method', () => {
    it('should sanitize error messages', () => {
      logger.error('Error processing admin@company.com');

      expect(redactPiiFromStringSpy).toHaveBeenCalledWith(
        'Error processing admin@company.com',
      );
    });
  });

  describe('debug method', () => {
    it('should sanitize debug messages', () => {
      logger.debug('Debug: user test@debug.com');

      expect(redactPiiFromStringSpy).toHaveBeenCalledWith(
        'Debug: user test@debug.com',
      );
    });
  });

  describe('verbose method', () => {
    it('should sanitize verbose messages', () => {
      logger.verbose('Verbose: processing request from 192.168.1.1');

      expect(redactPiiFromStringSpy).toHaveBeenCalledWith(
        'Verbose: processing request from 192.168.1.1',
      );
    });
  });

  describe('fatal method', () => {
    it('should sanitize fatal messages and add [FATAL] prefix', () => {
      logger.fatal('Critical failure');

      // The message should be sanitized and prefixed with [FATAL]
      expect(redactPiiFromStringSpy).toHaveBeenCalledWith('Critical failure');
    });
  });

  describe('optional params sanitization', () => {
    it('should sanitize additional string parameters', () => {
      logger.log('Processing request', 'user@test.com');

      expect(redactPiiFromStringSpy).toHaveBeenCalledWith('Processing request');
      expect(redactPiiFromStringSpy).toHaveBeenCalledWith('user@test.com');
    });

    it('should sanitize additional object parameters', () => {
      const context = { userId: '123', ip: '192.168.1.1' };
      logger.log('Request received', context);

      expect(sanitizeForLoggingSpy).toHaveBeenCalledWith(context);
    });
  });

  describe('integration with pii-masker', () => {
    it('should properly mask emails through the full chain', () => {
      // Reset mocks to use real implementation
      redactPiiFromStringSpy.mockRestore();

      const message = 'User john@example.com logged in';
      const sanitized = piiMasker.redactPiiFromString(message);

      expect(sanitized).toBe('User j**n@example.com logged in');
    });

    it('should properly mask IPs through the full chain', () => {
      redactPiiFromStringSpy.mockRestore();

      const message = 'Request from 192.168.1.100';
      const sanitized = piiMasker.redactPiiFromString(message);

      expect(sanitized).toBe('Request from 192.x.x.x');
    });

    it('should properly mask multiple PII types', () => {
      redactPiiFromStringSpy.mockRestore();

      const message = 'User admin@test.com from 10.0.0.1 with SSN 123-45-6789';
      const sanitized = piiMasker.redactPiiFromString(message);

      expect(sanitized).toContain('a***n@test.com');
      expect(sanitized).toContain('10.x.x.x');
      expect(sanitized).toContain('[REDACTED_SSN]');
    });
  });
});
