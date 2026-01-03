import {
  maskSensitiveData,
  maskEmail,
  maskIpAddress,
  redactPiiFromString,
  sanitizeForLogging,
  PII_PATTERNS,
} from './pii-masker';

describe('PII Masker', () => {
  describe('maskSensitiveData', () => {
    it('should return null for null input', () => {
      expect(maskSensitiveData(null)).toBeNull();
    });

    it('should return undefined for undefined input', () => {
      expect(maskSensitiveData(undefined)).toBeUndefined();
    });

    it('should return primitive values unchanged', () => {
      expect(maskSensitiveData('hello')).toBe('hello');
      expect(maskSensitiveData(123)).toBe(123);
      expect(maskSensitiveData(true)).toBe(true);
    });

    describe('sensitive field masking', () => {
      it('should fully mask password fields', () => {
        const input = { password: 'secret123' };
        const result = maskSensitiveData(input);
        expect(result).toEqual({ password: '[REDACTED]' });
      });

      it('should fully mask token fields', () => {
        const input = { accessToken: 'abc123', refreshToken: 'xyz789' };
        const result = maskSensitiveData(input);
        expect(result).toEqual({
          accessToken: '[REDACTED]',
          refreshToken: '[REDACTED]',
        });
      });

      it('should fully mask API key fields', () => {
        const input = { apiKey: 'sk-12345', apiSecret: 'secret' };
        const result = maskSensitiveData(input);
        expect(result).toEqual({
          apiKey: '[REDACTED]',
          apiSecret: '[REDACTED]',
        });
      });

      it('should be case-insensitive for sensitive fields', () => {
        const input = { PASSWORD: 'secret', Token: 'abc', APIKEY: 'key' };
        const result = maskSensitiveData(input);
        expect(result).toEqual({
          PASSWORD: '[REDACTED]',
          Token: '[REDACTED]',
          APIKEY: '[REDACTED]',
        });
      });
    });

    describe('partial masking', () => {
      it('should partially mask email addresses', () => {
        const input = { email: 'john@example.com' };
        const result = maskSensitiveData(input) as { email: string };
        expect(result.email).toBe('j**n@example.com');
      });

      it('should handle short email local parts', () => {
        const input = { email: 'ab@example.com' };
        const result = maskSensitiveData(input) as { email: string };
        expect(result.email).toBe('**@example.com');
      });

      it('should partially mask phone numbers', () => {
        const input = { phone: '1234567890' };
        const result = maskSensitiveData(input) as { phone: string };
        expect(result.phone).toBe('******7890');
      });

      it('should handle phoneNumber field', () => {
        const input = { phoneNumber: '555-123-4567' };
        const result = maskSensitiveData(input) as { phoneNumber: string };
        expect(result.phoneNumber).toContain('4567');
      });
    });

    describe('nested object handling', () => {
      it('should mask sensitive fields in nested objects', () => {
        const input = {
          user: {
            name: 'John',
            credentials: {
              password: 'secret',
              email: 'john@test.com',
            },
          },
        };
        const result = maskSensitiveData(input) as {
          user: {
            name: string;
            credentials: { password: string; email: string };
          };
        };
        expect(result.user.name).toBe('John');
        expect(result.user.credentials.password).toBe('[REDACTED]');
        expect(result.user.credentials.email).toBe('j**n@test.com');
      });

      it('should handle arrays of objects', () => {
        const input = [
          { password: 'pass1', name: 'User1' },
          { password: 'pass2', name: 'User2' },
        ];
        const result = maskSensitiveData(input) as Array<{
          password: string;
          name: string;
        }>;
        expect(result[0].password).toBe('[REDACTED]');
        expect(result[0].name).toBe('User1');
        expect(result[1].password).toBe('[REDACTED]');
        expect(result[1].name).toBe('User2');
      });
    });

    describe('depth limiting', () => {
      it('should stop recursing at max depth', () => {
        // Create deeply nested object
        let obj: Record<string, unknown> = { password: 'deep' };
        for (let i = 0; i < 15; i++) {
          obj = { nested: obj };
        }

        // Should not throw and should return something
        const result = maskSensitiveData(obj);
        expect(result).toBeDefined();
      });
    });

    describe('non-sensitive fields', () => {
      it('should not mask regular fields', () => {
        const input = {
          username: 'john',
          firstName: 'John',
          lastName: 'Doe',
          age: 30,
        };
        const result = maskSensitiveData(input);
        expect(result).toEqual(input);
      });
    });
  });

  /**
   * Tests for PII pattern-based redaction in strings
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
   */
  describe('PII_PATTERNS', () => {
    it('should have email pattern that matches valid emails', () => {
      const testCases = [
        'user@example.com',
        'john.doe@company.org',
        'test+tag@gmail.com',
        'name_123@sub.domain.co',
      ];
      testCases.forEach((email) => {
        PII_PATTERNS.email.lastIndex = 0; // Reset regex state
        expect(PII_PATTERNS.email.test(email)).toBe(true);
      });
    });

    it('should have phone pattern that matches US phone formats', () => {
      const testCases = [
        '123-456-7890',
        '(123) 456-7890',
        '1234567890',
        '+1 123-456-7890',
      ];
      testCases.forEach((phone) => {
        PII_PATTERNS.phone.lastIndex = 0;
        expect(PII_PATTERNS.phone.test(phone)).toBe(true);
      });
    });

    it('should have SSN pattern that matches XXX-XX-XXXX format', () => {
      const testCases = ['123-45-6789', '123 45 6789', '123.45.6789'];
      testCases.forEach((ssn) => {
        PII_PATTERNS.ssn.lastIndex = 0;
        expect(PII_PATTERNS.ssn.test(ssn)).toBe(true);
      });
    });

    it('should have credit card pattern that matches card numbers', () => {
      const testCases = [
        '4111-1111-1111-1111',
        '4111 1111 1111 1111',
        '4111111111111111',
      ];
      testCases.forEach((cc) => {
        PII_PATTERNS.creditCard.lastIndex = 0;
        expect(PII_PATTERNS.creditCard.test(cc)).toBe(true);
      });
    });

    it('should have IP address pattern that matches IPv4', () => {
      const testCases = ['192.168.1.1', '10.0.0.1', '255.255.255.255'];
      testCases.forEach((ip) => {
        PII_PATTERNS.ipAddress.lastIndex = 0;
        expect(PII_PATTERNS.ipAddress.test(ip)).toBe(true);
      });
    });
  });

  describe('maskEmail', () => {
    it('should mask email with partial local part visibility', () => {
      expect(maskEmail('john@example.com')).toBe('j**n@example.com');
      expect(maskEmail('jane.doe@company.org')).toBe('j******e@company.org');
    });

    it('should handle short local parts', () => {
      expect(maskEmail('ab@test.com')).toBe('**@test.com');
      expect(maskEmail('a@test.com')).toBe('*@test.com');
    });

    it('should return redacted for invalid emails', () => {
      expect(maskEmail('invalid')).toBe('[REDACTED_EMAIL]');
      expect(maskEmail('')).toBe('[REDACTED_EMAIL]');
    });
  });

  describe('maskIpAddress', () => {
    it('should show only first octet', () => {
      expect(maskIpAddress('192.168.1.100')).toBe('192.x.x.x');
      expect(maskIpAddress('10.0.0.1')).toBe('10.x.x.x');
    });

    it('should return redacted for invalid IPs', () => {
      expect(maskIpAddress('invalid')).toBe('[REDACTED_IP]');
      expect(maskIpAddress('192.168.1')).toBe('[REDACTED_IP]');
    });
  });

  describe('redactPiiFromString', () => {
    it('should redact emails in log messages', () => {
      const message = 'User john@example.com logged in successfully';
      const result = redactPiiFromString(message);
      expect(result).toBe('User j**n@example.com logged in successfully');
    });

    it('should redact multiple emails', () => {
      const message = 'Sent from admin@test.com to user@test.com';
      const result = redactPiiFromString(message);
      expect(result).toContain('a***n@test.com');
      expect(result).toContain('u**r@test.com');
    });

    it('should redact phone numbers showing last 4 digits', () => {
      const message = 'Call user at 555-123-4567';
      const result = redactPiiFromString(message);
      expect(result).toBe('Call user at ***-***-4567');
    });

    it('should fully redact SSN', () => {
      const message = 'SSN: 123-45-6789';
      const result = redactPiiFromString(message);
      expect(result).toBe('SSN: [REDACTED_SSN]');
    });

    it('should fully redact credit card numbers', () => {
      const message = 'Card: 4111-1111-1111-1111';
      const result = redactPiiFromString(message);
      expect(result).toBe('Card: [REDACTED_CC]');
    });

    it('should mask IP addresses', () => {
      const message = 'Request from 192.168.1.100';
      const result = redactPiiFromString(message);
      expect(result).toBe('Request from 192.x.x.x');
    });

    it('should handle messages with multiple PII types', () => {
      const message =
        'User john@test.com (IP: 10.0.0.1) failed login with SSN 123-45-6789';
      const result = redactPiiFromString(message);
      expect(result).toContain('j**n@test.com');
      expect(result).toContain('10.x.x.x');
      expect(result).toContain('[REDACTED_SSN]');
    });

    it('should return non-string values unchanged', () => {
      expect(redactPiiFromString(123 as unknown as string)).toBe(123);
      expect(redactPiiFromString(null as unknown as string)).toBe(null);
    });

    it('should not modify strings without PII', () => {
      const message = 'System started successfully';
      expect(redactPiiFromString(message)).toBe(message);
    });
  });

  describe('sanitizeForLogging', () => {
    it('should sanitize strings with PII', () => {
      const result = sanitizeForLogging('Email: user@test.com');
      expect(result).toBe('Email: u**r@test.com');
    });

    it('should sanitize objects with sensitive fields', () => {
      const input = { password: 'secret', email: 'test@test.com' };
      const result = sanitizeForLogging(input) as {
        password: string;
        email: string;
      };
      expect(result.password).toBe('[REDACTED]');
      expect(result.email).toBe('t**t@test.com');
    });

    it('should sanitize arrays', () => {
      const input = ['user1@test.com', 'user2@test.com'];
      const result = sanitizeForLogging(input) as string[];
      expect(result[0]).toContain('@test.com');
      expect(result[0]).not.toBe('user1@test.com');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeForLogging(null)).toBeNull();
      expect(sanitizeForLogging(undefined)).toBeUndefined();
    });

    it('should pass through numbers and booleans', () => {
      expect(sanitizeForLogging(42)).toBe(42);
      expect(sanitizeForLogging(true)).toBe(true);
    });
  });
});
