/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

import { DbService } from '@qckstrt/relationaldb-provider';
import { createMockDbService } from '@qckstrt/relationaldb-provider/testing';
import { PasskeyService } from './passkey.service';

// Mock @simplewebauthn/server
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import * as simplewebauthn from '@simplewebauthn/server';

describe('PasskeyService', () => {
  let service: PasskeyService;
  let mockDb: ReturnType<typeof createMockDbService>;

  // Using 'any' type for mock objects to avoid strict type checking
  const mockCredential: any = {
    id: 'cred-1',
    userId: 'user-1',
    credentialId: 'credential-id-123',
    publicKey: Buffer.from('publickey').toString('base64url'),
    counter: BigInt(0),
    deviceType: 'singleDevice',
    backedUp: false,
    friendlyName: 'Test Device',
    transports: ['internal'],
    createdAt: new Date(),
    lastUsedAt: new Date(),
    user: {
      id: 'user-1',
      email: 'test@example.com',
    },
  };

  const mockChallenge: any = {
    identifier: 'test@example.com',
    challenge: 'challenge-string',
    type: 'registration',
    expiresAt: new Date(Date.now() + 300000), // 5 minutes from now
    createdAt: new Date(),
  };

  // Mock WebAuthn response objects with proper types
  const mockRegistrationResponse: RegistrationResponseJSON = {
    id: 'credential-id-123',
    rawId: 'credential-id-123',
    response: {
      clientDataJSON: 'mock-client-data',
      attestationObject: 'mock-attestation',
    },
    clientExtensionResults: {},
    type: 'public-key',
  };

  const mockAuthenticationResponse: AuthenticationResponseJSON = {
    id: 'credential-id-123',
    rawId: 'credential-id-123',
    response: {
      clientDataJSON: 'mock-client-data',
      authenticatorData: 'mock-auth-data',
      signature: 'mock-signature',
    },
    clientExtensionResults: {},
    type: 'public-key',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        'webauthn.rpName': 'TestApp',
        'webauthn.rpId': 'localhost',
        'webauthn.origin': 'http://localhost:3000',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    mockDb = createMockDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasskeyService,
        { provide: DbService, useValue: mockDb },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PasskeyService>(PasskeyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('WebAuthn configuration validation', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should throw error in production when rpId is missing', async () => {
      process.env.NODE_ENV = 'production';

      await expect(
        Test.createTestingModule({
          providers: [
            PasskeyService,
            { provide: DbService, useValue: createMockDbService() },
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'webauthn.origin') return 'https://example.com';
                  return undefined; // rpId is missing
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow(
        'WebAuthn rpId must be configured in production (WEBAUTHN_RP_ID)',
      );
    });

    it('should throw error in production when origin is missing', async () => {
      process.env.NODE_ENV = 'production';

      await expect(
        Test.createTestingModule({
          providers: [
            PasskeyService,
            { provide: DbService, useValue: createMockDbService() },
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'webauthn.rpId') return 'example.com';
                  return undefined; // origin is missing
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow(
        'WebAuthn origin must be configured in production (WEBAUTHN_ORIGIN)',
      );
    });

    it('should initialize with defaults in non-production when config is missing', async () => {
      process.env.NODE_ENV = 'development';

      const module = await Test.createTestingModule({
        providers: [
          PasskeyService,
          { provide: DbService, useValue: createMockDbService() },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined), // All config missing
            },
          },
        ],
      }).compile();

      const testService = module.get<PasskeyService>(PasskeyService);
      expect(testService).toBeDefined();
    });

    it('should initialize correctly in production with all config values', async () => {
      process.env.NODE_ENV = 'production';

      const module = await Test.createTestingModule({
        providers: [
          PasskeyService,
          { provide: DbService, useValue: createMockDbService() },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, string> = {
                  'webauthn.rpName': 'Production App',
                  'webauthn.rpId': 'example.com',
                  'webauthn.origin': 'https://example.com',
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      const testService = module.get<PasskeyService>(PasskeyService);
      expect(testService).toBeDefined();
    });
  });

  describe('generateRegistrationOptions', () => {
    it('should generate registration options for a user', async () => {
      const mockOptions = {
        challenge: 'test-challenge',
        rp: { name: 'TestApp', id: 'localhost' },
      };

      mockDb.passkeyCredential.findMany.mockResolvedValue([]);
      (
        simplewebauthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });
      mockDb.webAuthnChallenge.create.mockResolvedValue(mockChallenge);

      const result = await service.generateRegistrationOptions(
        'user-1',
        'test@example.com',
        'Test User',
      );

      expect(result).toEqual(mockOptions);
      expect(simplewebauthn.generateRegistrationOptions).toHaveBeenCalled();
    });

    it('should exclude existing credentials from registration options', async () => {
      const mockOptions = { challenge: 'test-challenge' };

      mockDb.passkeyCredential.findMany.mockResolvedValue([mockCredential]);
      (
        simplewebauthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });
      mockDb.webAuthnChallenge.create.mockResolvedValue(mockChallenge);

      await service.generateRegistrationOptions(
        'user-1',
        'test@example.com',
        'Test User',
      );

      expect(simplewebauthn.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: expect.arrayContaining([
            expect.objectContaining({ id: mockCredential.credentialId }),
          ]),
        }),
      );
    });
  });

  describe('verifyRegistration', () => {
    it('should verify registration successfully', async () => {
      const mockVerification = {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-id',
            publicKey: new Uint8Array(),
            counter: 0,
          },
        },
      };

      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(mockChallenge);
      (
        simplewebauthn.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue(mockVerification);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyRegistration(
        'test@example.com',
        mockRegistrationResponse,
      );

      expect(result).toEqual(mockVerification);
      expect(mockDb.webAuthnChallenge.deleteMany).toHaveBeenCalled();
    });

    it('should throw error when challenge not found', async () => {
      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyRegistration(
          'test@example.com',
          mockRegistrationResponse,
        ),
      ).rejects.toThrow('Challenge not found or expired');
    });

    it('should throw error when challenge is expired', async () => {
      const expiredChallenge = {
        ...mockChallenge,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };
      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(expiredChallenge);

      await expect(
        service.verifyRegistration(
          'test@example.com',
          mockRegistrationResponse,
        ),
      ).rejects.toThrow('Challenge not found or expired');
    });
  });

  describe('saveCredential', () => {
    it('should save a verified credential', async () => {
      const mockVerification = {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      };

      mockDb.passkeyCredential.create.mockResolvedValue(mockCredential);

      const result = await service.saveCredential(
        'user-1',
        mockVerification as any,
        'My Passkey',
      );

      expect(result).toEqual(mockCredential);
      expect(mockDb.passkeyCredential.create).toHaveBeenCalled();
    });

    it('should use default friendly name when not provided', async () => {
      const mockVerification = {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      };

      mockDb.passkeyCredential.create.mockResolvedValue(mockCredential);

      await service.saveCredential('user-1', mockVerification as any);

      expect(mockDb.passkeyCredential.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          friendlyName: 'This device',
        }),
      });
    });

    it('should use synced passkey name for multiDevice', async () => {
      const mockVerification = {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      };

      mockDb.passkeyCredential.create.mockResolvedValue(mockCredential);

      await service.saveCredential('user-1', mockVerification as any);

      expect(mockDb.passkeyCredential.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          friendlyName: 'Synced passkey',
        }),
      });
    });

    it('should use default passkey name for unknown device type', async () => {
      const mockVerification = {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
          credentialDeviceType: undefined,
          credentialBackedUp: false,
        },
      };

      mockDb.passkeyCredential.create.mockResolvedValue(mockCredential);

      await service.saveCredential('user-1', mockVerification as any);

      expect(mockDb.passkeyCredential.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          friendlyName: 'Passkey',
        }),
      });
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('should generate authentication options without email', async () => {
      const mockOptions = { challenge: 'auth-challenge' };

      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });
      mockDb.webAuthnChallenge.create.mockResolvedValue(mockChallenge);

      const result = await service.generateAuthenticationOptions();

      expect(result.options).toEqual(mockOptions);
      expect(result.identifier).toMatch(/^anon_/);
    });

    it('should generate authentication options with email', async () => {
      const mockOptions = { challenge: 'auth-challenge' };
      const mockUser: any = {
        id: 'user-1',
        email: 'test@example.com',
        passkeyCredentials: [mockCredential],
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });
      mockDb.webAuthnChallenge.create.mockResolvedValue(mockChallenge);

      const result =
        await service.generateAuthenticationOptions('test@example.com');

      expect(result.options).toEqual(mockOptions);
      expect(result.identifier).toBe('test@example.com');
      expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: expect.arrayContaining([
            expect.objectContaining({ id: mockCredential.credentialId }),
          ]),
        }),
      );
    });

    it('should generate options without allowCredentials when no credentials found', async () => {
      const mockOptions = { challenge: 'auth-challenge' };
      const mockUser: any = {
        id: 'user-1',
        email: 'test@example.com',
        passkeyCredentials: [],
      };

      mockDb.user.findUnique.mockResolvedValue(mockUser);
      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });
      mockDb.webAuthnChallenge.create.mockResolvedValue(mockChallenge);

      await service.generateAuthenticationOptions('test@example.com');

      expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: undefined,
        }),
      );
    });

    it('should generate options without allowCredentials when user not found', async () => {
      const mockOptions = { challenge: 'auth-challenge' };

      mockDb.user.findUnique.mockResolvedValue(null);
      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });
      mockDb.webAuthnChallenge.create.mockResolvedValue(mockChallenge);

      await service.generateAuthenticationOptions('test@example.com');

      expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: undefined,
        }),
      );
    });
  });

  describe('verifyAuthentication', () => {
    it('should verify authentication successfully', async () => {
      const mockVerification = {
        verified: true,
        authenticationInfo: { newCounter: 1 },
      };

      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(mockChallenge);
      mockDb.passkeyCredential.findUnique.mockResolvedValue(mockCredential);
      (
        simplewebauthn.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue(mockVerification);
      mockDb.passkeyCredential.update.mockResolvedValue(mockCredential);
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyAuthentication(
        'test@example.com',
        mockAuthenticationResponse,
      );

      expect(result.verification).toEqual(mockVerification);
      expect(result.user).toBeDefined();
      expect(mockDb.passkeyCredential.update).toHaveBeenCalled();
    });

    it('should throw error when challenge not found', async () => {
      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication(
          'test@example.com',
          mockAuthenticationResponse,
        ),
      ).rejects.toThrow('Challenge not found or expired');
    });

    it('should throw error when credential not found', async () => {
      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(mockChallenge);
      mockDb.passkeyCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication('test@example.com', {
          ...mockAuthenticationResponse,
          id: 'unknown-cred',
        }),
      ).rejects.toThrow('Credential not found');
    });

    it('should not update counter when verification fails', async () => {
      const mockVerification = {
        verified: false,
        authenticationInfo: { newCounter: 1 },
      };

      mockDb.webAuthnChallenge.findFirst.mockResolvedValue(mockChallenge);
      mockDb.passkeyCredential.findUnique.mockResolvedValue(mockCredential);
      (
        simplewebauthn.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue(mockVerification);

      const result = await service.verifyAuthentication(
        'test@example.com',
        mockAuthenticationResponse,
      );

      expect(result.verification.verified).toBe(false);
      expect(mockDb.passkeyCredential.update).not.toHaveBeenCalled();
    });
  });

  describe('getUserCredentials', () => {
    it('should return user credentials', async () => {
      mockDb.passkeyCredential.findMany.mockResolvedValue([mockCredential]);

      const result = await service.getUserCredentials('user-1');

      expect(result).toEqual([mockCredential]);
      expect(mockDb.passkeyCredential.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('deleteCredential', () => {
    it('should delete credential successfully', async () => {
      mockDb.passkeyCredential.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteCredential('cred-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should return false when credential not found', async () => {
      mockDb.passkeyCredential.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.deleteCredential('unknown-cred', 'user-1');

      expect(result).toBe(false);
    });
  });

  describe('userHasPasskeys', () => {
    it('should return true when user has passkeys', async () => {
      mockDb.passkeyCredential.count.mockResolvedValue(2);

      const result = await service.userHasPasskeys('user-1');

      expect(result).toBe(true);
    });

    it('should return false when user has no passkeys', async () => {
      mockDb.passkeyCredential.count.mockResolvedValue(0);

      const result = await service.userHasPasskeys('user-1');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredChallenges', () => {
    it('should cleanup expired challenges', async () => {
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupExpiredChallenges();

      expect(result).toBe(5);
    });

    it('should return 0 when no challenges expired', async () => {
      mockDb.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupExpiredChallenges();

      expect(result).toBe(0);
    });
  });
});
