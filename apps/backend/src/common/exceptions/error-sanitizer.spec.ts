import { HttpStatus } from '@nestjs/common';
import {
  containsSensitiveInfo,
  sanitizeErrorMessage,
  sanitizeDatabaseError,
  createSanitizedResponse,
  isProduction,
  GENERIC_ERROR_MESSAGES,
} from './error-sanitizer';

describe('ErrorSanitizer', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('isProduction', () => {
    it('should return true in production', () => {
      process.env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
    });

    it('should return false in development', () => {
      process.env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });

    it('should return false in test', () => {
      process.env.NODE_ENV = 'test';
      expect(isProduction()).toBe(false);
    });
  });

  describe('containsSensitiveInfo', () => {
    it('should return false for empty message', () => {
      expect(containsSensitiveInfo('')).toBe(false);
    });

    it('should return false for safe messages', () => {
      expect(containsSensitiveInfo('Invalid email format')).toBe(false);
      expect(containsSensitiveInfo('User not found')).toBe(false);
      expect(containsSensitiveInfo('Invalid credentials')).toBe(false);
      expect(containsSensitiveInfo('Session expired')).toBe(false);
      expect(containsSensitiveInfo('Too many requests')).toBe(false);
    });

    it('should detect database column errors', () => {
      expect(
        containsSensitiveInfo('column "password_hash" does not exist'),
      ).toBe(true);
      expect(containsSensitiveInfo('column user_id of relation users')).toBe(
        true,
      );
    });

    it('should detect database relation errors', () => {
      expect(containsSensitiveInfo('relation "users" does not exist')).toBe(
        true,
      );
    });

    it('should detect unique constraint violations', () => {
      expect(
        containsSensitiveInfo(
          'duplicate key value violates unique constraint "users_email_key"',
        ),
      ).toBe(true);
    });

    it('should detect foreign key violations', () => {
      expect(containsSensitiveInfo('violates foreign key constraint')).toBe(
        true,
      );
    });

    it('should detect syntax errors', () => {
      expect(containsSensitiveInfo('syntax error at or near "SELECT"')).toBe(
        true,
      );
    });

    it('should detect file system paths', () => {
      expect(
        containsSensitiveInfo('/home/user/app/src/services/auth.service.ts'),
      ).toBe(true);
      expect(containsSensitiveInfo('C:\\Users\\admin\\app\\src')).toBe(true);
    });

    it('should detect stack traces', () => {
      expect(
        containsSensitiveInfo(
          'at AuthService.validateUser (/app/src/auth.service.ts:42:15)',
        ),
      ).toBe(true);
    });

    it('should detect node_modules paths', () => {
      expect(
        containsSensitiveInfo('Error in node_modules/typeorm/entity.js'),
      ).toBe(true);
    });

    it('should detect database connection strings', () => {
      expect(
        containsSensitiveInfo('postgresql://user:password@localhost:5432/db'),
      ).toBe(true);
      expect(
        containsSensitiveInfo('mongodb+srv://admin:secret@cluster.mongodb.net'),
      ).toBe(true);
    });

    it('should detect API keys and tokens in messages', () => {
      expect(containsSensitiveInfo('api_key=sk_live_123abc')).toBe(true);
      expect(containsSensitiveInfo('token: eyJhbGciOiJIUzI1NiIs')).toBe(true);
    });

    it('should detect internal IP addresses', () => {
      expect(containsSensitiveInfo('Connection to 192.168.1.100 failed')).toBe(
        true,
      );
      expect(containsSensitiveInfo('Server at 10.0.0.50 not responding')).toBe(
        true,
      );
    });

    it('should detect localhost references', () => {
      expect(containsSensitiveInfo('localhost:3000')).toBe(true);
      expect(containsSensitiveInfo('127.0.0.1:5432')).toBe(true);
    });

    it('should detect Key already exists errors', () => {
      expect(
        containsSensitiveInfo('Key (email)=(test@example.com) already exists.'),
      ).toBe(true);
    });

    it('should detect Key not present errors', () => {
      expect(
        containsSensitiveInfo(
          'Key (user_id)=(123) is not present in table "users".',
        ),
      ).toBe(true);
    });
  });

  describe('sanitizeErrorMessage', () => {
    describe('in development', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
      });

      it('should return original message', () => {
        const message = 'column "password" does not exist';
        expect(sanitizeErrorMessage(message, HttpStatus.BAD_REQUEST)).toBe(
          message,
        );
      });

      it('should return original message for 500 errors', () => {
        const message = 'Internal server error with stack trace';
        expect(
          sanitizeErrorMessage(message, HttpStatus.INTERNAL_SERVER_ERROR),
        ).toBe(message);
      });
    });

    describe('in production', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      it('should return generic message for 5xx errors', () => {
        expect(sanitizeErrorMessage('Database connection failed', 500)).toBe(
          GENERIC_ERROR_MESSAGES[500],
        );

        expect(sanitizeErrorMessage('Service unavailable', 503)).toBe(
          GENERIC_ERROR_MESSAGES[503],
        );
      });

      it('should sanitize sensitive 4xx errors', () => {
        expect(
          sanitizeErrorMessage(
            'column "password_hash" does not exist',
            HttpStatus.BAD_REQUEST,
          ),
        ).toBe(GENERIC_ERROR_MESSAGES[HttpStatus.BAD_REQUEST]);
      });

      it('should pass through safe 4xx errors', () => {
        expect(
          sanitizeErrorMessage('Invalid email format', HttpStatus.BAD_REQUEST),
        ).toBe('Invalid email format');
      });

      it('should use fallback for unknown status codes', () => {
        expect(sanitizeErrorMessage('Some sensitive error', 599)).toBe(
          GENERIC_ERROR_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR],
        );
      });
    });
  });

  describe('sanitizeDatabaseError', () => {
    describe('in development', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'development';
      });

      it('should return original detail', () => {
        const detail = 'Key (email)=(test@example.com) already exists.';
        expect(sanitizeDatabaseError(detail, '23505')).toBe(detail);
      });
    });

    describe('in production', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      it('should return user-friendly message for unique violation', () => {
        expect(
          sanitizeDatabaseError(
            'Key (email)=(test@example.com) already exists.',
            '23505',
          ),
        ).toBe('This record already exists.');
      });

      it('should return user-friendly message for foreign key violation', () => {
        expect(
          sanitizeDatabaseError(
            'Key (user_id)=(123) is not present in table "users".',
            '23503',
          ),
        ).toBe('This operation references a record that does not exist.');
      });

      it('should return user-friendly message for not null violation', () => {
        expect(
          sanitizeDatabaseError('null value in column "name"', '23502'),
        ).toBe('Required information is missing.');
      });

      it('should return user-friendly message for check violation', () => {
        expect(
          sanitizeDatabaseError('violates check constraint', '23514'),
        ).toBe('The provided data does not meet requirements.');
      });

      it('should return generic message for undefined table', () => {
        expect(
          sanitizeDatabaseError('relation "users" does not exist', '42P01'),
        ).toBe('An internal error occurred.');
      });

      it('should return generic message for undefined column', () => {
        expect(
          sanitizeDatabaseError('column "foo" does not exist', '42703'),
        ).toBe('An internal error occurred.');
      });

      it('should return generic message for unknown error codes', () => {
        expect(sanitizeDatabaseError('Some unknown error', '99999')).toBe(
          'A database error occurred.',
        );
      });
    });
  });

  describe('createSanitizedResponse', () => {
    it('should create response with sanitized message', () => {
      process.env.NODE_ENV = 'production';

      const response = createSanitizedResponse(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Database connection string: postgres://user:pass@host',
        '/api/users',
      );

      expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(response.message).toBe(
        GENERIC_ERROR_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR],
      );
      expect(response.path).toBe('/api/users');
      expect(response.timestamp).toBeDefined();
    });

    it('should include path when provided', () => {
      const response = createSanitizedResponse(
        HttpStatus.BAD_REQUEST,
        'Bad request',
        '/api/test',
      );

      expect(response.path).toBe('/api/test');
    });

    it('should not include path when not provided', () => {
      const response = createSanitizedResponse(
        HttpStatus.BAD_REQUEST,
        'Bad request',
      );

      expect(response.path).toBeUndefined();
    });
  });

  describe('GENERIC_ERROR_MESSAGES', () => {
    it('should have messages for common status codes', () => {
      expect(GENERIC_ERROR_MESSAGES[400]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[401]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[403]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[404]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[429]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[500]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[502]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[503]).toBeDefined();
      expect(GENERIC_ERROR_MESSAGES[504]).toBeDefined();
    });

    it('should not expose sensitive information in messages', () => {
      Object.values(GENERIC_ERROR_MESSAGES).forEach((message) => {
        expect(containsSensitiveInfo(message)).toBe(false);
      });
    });
  });
});
