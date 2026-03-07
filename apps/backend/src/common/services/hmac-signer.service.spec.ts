import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { HmacSignerService } from './hmac-signer.service';

// NOSONAR: Test constants are not real credentials

describe('HmacSignerService', () => {
  let service: HmacSignerService;

  const TEST_SECRET = 'test-hmac-secret-key-for-signing';
  const TEST_CLIENT_ID = 'test-gateway';

  function createService(
    secret: string | undefined = TEST_SECRET,
    clientId: string | undefined = TEST_CLIENT_ID,
  ): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        HmacSignerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'GATEWAY_HMAC_SECRET') return secret;
              if (key === 'GATEWAY_CLIENT_ID') return clientId;
              return undefined;
            }),
          },
        },
      ],
    }).compile();
  }

  beforeEach(async () => {
    const module = await createService();
    service = module.get<HmacSignerService>(HmacSignerService);
  });

  describe('isEnabled', () => {
    it('should return true when secret is configured', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('should return false when secret is empty', async () => {
      const module = await createService('');
      const disabledService = module.get<HmacSignerService>(HmacSignerService);
      expect(disabledService.isEnabled()).toBe(false);
    });

    it('should return false when secret is not configured', async () => {
      const module = await Test.createTestingModule({
        providers: [
          HmacSignerService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();
      const disabledService = module.get<HmacSignerService>(HmacSignerService);
      expect(disabledService.isEnabled()).toBe(false);
    });
  });

  describe('sign', () => {
    it('should return a valid HMAC header string', () => {
      const result = service.sign('POST', '/graphql');

      expect(result).toMatch(/^HMAC \{.*\}$/);
    });

    it('should include correct credentials in the header', () => {
      const result = service.sign('POST', '/graphql');
      const jsonStr = result.replace('HMAC ', '');
      const credentials = JSON.parse(jsonStr);

      expect(credentials.username).toBe(TEST_CLIENT_ID);
      expect(credentials.algorithm).toBe('hmac-sha256');
      expect(credentials.headers).toBe('@request-target,content-type');
      expect(credentials.signature).toBeDefined();
      expect(typeof credentials.signature).toBe('string');
    });

    it('should produce a valid base64 HMAC-SHA256 signature', () => {
      const result = service.sign('POST', '/graphql');
      const credentials = JSON.parse(result.replace('HMAC ', ''));

      // Manually compute expected signature
      const signatureString = 'post /graphql\ncontent-type: application/json';
      const expected = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(signatureString)
        .digest('base64');

      expect(credentials.signature).toBe(expected);
    });

    it('should use custom content type when provided', () => {
      const result = service.sign('POST', '/graphql', 'text/plain');
      const credentials = JSON.parse(result.replace('HMAC ', ''));

      const signatureString = 'post /graphql\ncontent-type: text/plain';
      const expected = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(signatureString)
        .digest('base64');

      expect(credentials.signature).toBe(expected);
    });

    it('should lowercase the HTTP method in the signature', () => {
      const resultLower = service.sign('post', '/graphql');
      const resultUpper = service.sign('POST', '/graphql');

      const credLower = JSON.parse(resultLower.replace('HMAC ', ''));
      const credUpper = JSON.parse(resultUpper.replace('HMAC ', ''));

      expect(credLower.signature).toBe(credUpper.signature);
    });

    it('should produce different signatures for different paths', () => {
      const result1 = service.sign('POST', '/graphql');
      const result2 = service.sign('POST', '/api/v1');

      const cred1 = JSON.parse(result1.replace('HMAC ', ''));
      const cred2 = JSON.parse(result2.replace('HMAC ', ''));

      expect(cred1.signature).not.toBe(cred2.signature);
    });

    it('should produce different signatures for different methods', () => {
      const result1 = service.sign('POST', '/graphql');
      const result2 = service.sign('GET', '/graphql');

      const cred1 = JSON.parse(result1.replace('HMAC ', ''));
      const cred2 = JSON.parse(result2.replace('HMAC ', ''));

      expect(cred1.signature).not.toBe(cred2.signature);
    });

    it('should return empty string when signing is disabled', async () => {
      const module = await createService('');
      const disabledService = module.get<HmacSignerService>(HmacSignerService);

      expect(disabledService.sign('POST', '/graphql')).toBe('');
    });

    it('should handle empty path', () => {
      const result = service.sign('POST', '');
      expect(result).toMatch(/^HMAC \{.*\}$/);
    });

    it('should handle special characters in path', () => {
      const result = service.sign('POST', '/api/v1?query=test&foo=bar');
      expect(result).toMatch(/^HMAC \{.*\}$/);
    });
  });

  describe('signGraphQLRequest', () => {
    it('should extract pathname and sign with POST method', () => {
      const result = service.signGraphQLRequest('http://users:8080/graphql');
      const credentials = JSON.parse(result.replace('HMAC ', ''));

      const signatureString = 'post /graphql\ncontent-type: application/json';
      const expected = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(signatureString)
        .digest('base64');

      expect(credentials.signature).toBe(expected);
    });

    it('should handle URLs with different paths', () => {
      const result = service.signGraphQLRequest(
        'http://documents:8080/graphql',
      );

      expect(result).toMatch(/^HMAC \{.*\}$/);
      const credentials = JSON.parse(result.replace('HMAC ', ''));
      expect(credentials.username).toBe(TEST_CLIENT_ID);
    });

    it('should fall back to /graphql for invalid URLs', () => {
      const result = service.signGraphQLRequest('not-a-valid-url');
      const credentials = JSON.parse(result.replace('HMAC ', ''));

      // Should use /graphql as fallback path
      const signatureString = 'post /graphql\ncontent-type: application/json';
      const expected = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(signatureString)
        .digest('base64');

      expect(credentials.signature).toBe(expected);
    });

    it('should return empty string when signing is disabled', async () => {
      const module = await createService('');
      const disabledService = module.get<HmacSignerService>(HmacSignerService);

      expect(
        disabledService.signGraphQLRequest('http://users:8080/graphql'),
      ).toBe('');
    });
  });

  describe('constructor', () => {
    it('should use default client ID when not configured', async () => {
      const module = await Test.createTestingModule({
        providers: [
          HmacSignerService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'GATEWAY_HMAC_SECRET') return TEST_SECRET;
                return undefined;
              }),
            },
          },
        ],
      }).compile();
      const svc = module.get<HmacSignerService>(HmacSignerService);

      const result = svc.sign('POST', '/graphql');
      const credentials = JSON.parse(result.replace('HMAC ', ''));

      expect(credentials.username).toBe('api-gateway');
    });
  });
});
