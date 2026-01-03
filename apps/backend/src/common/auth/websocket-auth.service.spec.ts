import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebSocketAuthService } from './websocket-auth.service';

/**
 * Tests for WebSocket Authentication Service
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
 */
describe('WebSocketAuthService', () => {
  let service: WebSocketAuthService;

  const mockSupabaseConfig = {
    url: 'https://test-project.supabase.co',
    anonKey: 'test-anon-key',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSocketAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'supabase') return mockSupabaseConfig;
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebSocketAuthService>(WebSocketAuthService);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should throw error if supabase config is missing', async () => {
      const badConfigService = {
        get: jest.fn().mockReturnValue(null),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            WebSocketAuthService,
            { provide: ConfigService, useValue: badConfigService },
          ],
        }).compile(),
      ).rejects.toThrow('Supabase configuration is missing');
    });
  });

  describe('validateToken', () => {
    it('should return null for empty token', async () => {
      const result = await service.validateToken('');
      expect(result).toBeNull();
    });

    it('should return null for null token', async () => {
      const result = await service.validateToken(null as unknown as string);
      expect(result).toBeNull();
    });

    it('should return null for undefined token', async () => {
      const result = await service.validateToken(
        undefined as unknown as string,
      );
      expect(result).toBeNull();
    });

    it('should strip Bearer prefix from token', async () => {
      // This will fail validation but should not throw due to Bearer prefix
      const result = await service.validateToken('Bearer invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for malformed JWT', async () => {
      const result = await service.validateToken('not-a-valid-jwt');
      expect(result).toBeNull();
    });

    it('should return null for JWT with invalid signature', async () => {
      // A properly formatted but invalid JWT
      const invalidJwt =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwiaWF0IjoxNTE2MjM5MDIyfQ.invalid-signature';
      const result = await service.validateToken(invalidJwt);
      expect(result).toBeNull();
    });
  });

  describe('authenticateConnection', () => {
    it('should throw error for missing connection params', async () => {
      await expect(
        service.authenticateConnection({} as Record<string, unknown>),
      ).rejects.toThrow('Missing authentication token');
    });

    it('should accept authorization in connection params', async () => {
      // Will fail validation but should attempt with the token
      await expect(
        service.authenticateConnection({ authorization: 'invalid-token' }),
      ).rejects.toThrow('Invalid authentication token');
    });

    it('should accept Authorization (capitalized) in connection params', async () => {
      await expect(
        service.authenticateConnection({ Authorization: 'invalid-token' }),
      ).rejects.toThrow('Invalid authentication token');
    });

    it('should accept authToken in connection params', async () => {
      await expect(
        service.authenticateConnection({ authToken: 'invalid-token' }),
      ).rejects.toThrow('Invalid authentication token');
    });

    it('should accept accessToken in connection params', async () => {
      await expect(
        service.authenticateConnection({ accessToken: 'invalid-token' }),
      ).rejects.toThrow('Invalid authentication token');
    });

    it('should throw for empty authorization value', async () => {
      await expect(
        service.authenticateConnection({ authorization: '' }),
      ).rejects.toThrow('Missing authentication token');
    });
  });

  describe('token validation logging', () => {
    let loggerWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      // Access the private logger through any type assertion
      loggerWarnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation();
    });

    afterEach(() => {
      loggerWarnSpy.mockRestore();
    });

    it('should log warning for missing token', async () => {
      await service.validateToken('');
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'WebSocket auth failed: No token provided',
      );
    });

    it('should log warning for invalid token', async () => {
      await service.validateToken('invalid-token');
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  describe('connection authentication logging', () => {
    let loggerWarnSpy: jest.SpyInstance;
    let loggerLogSpy: jest.SpyInstance;

    beforeEach(() => {
      loggerWarnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation();
      loggerLogSpy = jest
        .spyOn(
          (service as unknown as { logger: { log: jest.Mock } }).logger,
          'log',
        )
        .mockImplementation();
    });

    afterEach(() => {
      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should log warning when connection is rejected for missing token', async () => {
      await expect(service.authenticateConnection({})).rejects.toThrow();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'WebSocket connection rejected: Missing authentication token',
      );
    });

    it('should log warning when connection is rejected for invalid token', async () => {
      await expect(
        service.authenticateConnection({ authorization: 'invalid' }),
      ).rejects.toThrow();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'WebSocket connection rejected: Invalid authentication token',
      );
    });
  });

  describe('security considerations', () => {
    it('should not expose internal errors in authentication failure', async () => {
      // Ensure the error message is generic and doesn't leak internal details
      try {
        await service.authenticateConnection({ authorization: 'malformed' });
      } catch (error) {
        expect((error as Error).message).toBe('Invalid authentication token');
        // Should not contain stack trace or internal error details
        expect((error as Error).message).not.toContain('jwt');
        expect((error as Error).message).not.toContain('supabase');
      }
    });

    it('should handle null connection params gracefully', async () => {
      await expect(
        service.authenticateConnection(
          null as unknown as Record<string, unknown>,
        ),
      ).rejects.toThrow();
    });

    it('should handle undefined connection params gracefully', async () => {
      await expect(
        service.authenticateConnection(
          undefined as unknown as Record<string, unknown>,
        ),
      ).rejects.toThrow();
    });
  });
});
