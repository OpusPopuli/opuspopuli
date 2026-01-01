/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';

import { PasskeyService } from './passkey.service';
import { PasskeyCredentialEntity } from 'src/db/entities/passkey-credential.entity';
import { WebAuthnChallengeEntity } from 'src/db/entities/webauthn-challenge.entity';

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
  let credentialRepo: Repository<PasskeyCredentialEntity>;
  let challengeRepo: Repository<WebAuthnChallengeEntity>;
  let configService: ConfigService;

  const mockCredential: Partial<PasskeyCredentialEntity> = {
    id: 'cred-1',
    userId: 'user-1',
    credentialId: 'credential-id-123',
    publicKey: Buffer.from('publickey').toString('base64url'),
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
    friendlyName: 'Test Device',
    transports: ['internal'],
    createdAt: new Date(),
    lastUsedAt: new Date(),
    user: {
      id: 'user-1',
      email: 'test@example.com',
    } as any,
  };

  const mockChallenge: Partial<WebAuthnChallengeEntity> = {
    identifier: 'test@example.com',
    challenge: 'challenge-string',
    type: 'registration',
    expiresAt: new Date(Date.now() + 300000), // 5 minutes from now
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasskeyService,
        {
          provide: getRepositoryToken(PasskeyCredentialEntity),
          useValue: createMock<Repository<PasskeyCredentialEntity>>(),
        },
        {
          provide: getRepositoryToken(WebAuthnChallengeEntity),
          useValue: createMock<Repository<WebAuthnChallengeEntity>>(),
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                'webauthn.rpName': 'TestApp',
                'webauthn.rpId': 'localhost',
                'webauthn.origin': 'http://localhost:3000',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PasskeyService>(PasskeyService);
    credentialRepo = module.get<Repository<PasskeyCredentialEntity>>(
      getRepositoryToken(PasskeyCredentialEntity),
    );
    challengeRepo = module.get<Repository<WebAuthnChallengeEntity>>(
      getRepositoryToken(WebAuthnChallengeEntity),
    );
    configService = module.get<ConfigService>(ConfigService);
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
            {
              provide: getRepositoryToken(PasskeyCredentialEntity),
              useValue: createMock<Repository<PasskeyCredentialEntity>>(),
            },
            {
              provide: getRepositoryToken(WebAuthnChallengeEntity),
              useValue: createMock<Repository<WebAuthnChallengeEntity>>(),
            },
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
            {
              provide: getRepositoryToken(PasskeyCredentialEntity),
              useValue: createMock<Repository<PasskeyCredentialEntity>>(),
            },
            {
              provide: getRepositoryToken(WebAuthnChallengeEntity),
              useValue: createMock<Repository<WebAuthnChallengeEntity>>(),
            },
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
          {
            provide: getRepositoryToken(PasskeyCredentialEntity),
            useValue: createMock<Repository<PasskeyCredentialEntity>>(),
          },
          {
            provide: getRepositoryToken(WebAuthnChallengeEntity),
            useValue: createMock<Repository<WebAuthnChallengeEntity>>(),
          },
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
          {
            provide: getRepositoryToken(PasskeyCredentialEntity),
            useValue: createMock<Repository<PasskeyCredentialEntity>>(),
          },
          {
            provide: getRepositoryToken(WebAuthnChallengeEntity),
            useValue: createMock<Repository<WebAuthnChallengeEntity>>(),
          },
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

      credentialRepo.find = jest.fn().mockResolvedValue([]);
      (
        simplewebauthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      challengeRepo.create = jest.fn().mockReturnValue({});
      challengeRepo.save = jest.fn().mockResolvedValue({});

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

      credentialRepo.find = jest.fn().mockResolvedValue([mockCredential]);
      (
        simplewebauthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      challengeRepo.create = jest.fn().mockReturnValue({});
      challengeRepo.save = jest.fn().mockResolvedValue({});

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

      challengeRepo.findOne = jest.fn().mockResolvedValue(mockChallenge);
      (
        simplewebauthn.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue(mockVerification);
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

      const result = await service.verifyRegistration('test@example.com', {});

      expect(result).toEqual(mockVerification);
      expect(challengeRepo.delete).toHaveBeenCalled();
    });

    it('should throw error when challenge not found', async () => {
      challengeRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.verifyRegistration('test@example.com', {}),
      ).rejects.toThrow('Challenge not found or expired');
    });

    it('should throw error when challenge is expired', async () => {
      const expiredChallenge = {
        ...mockChallenge,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };
      challengeRepo.findOne = jest.fn().mockResolvedValue(expiredChallenge);

      await expect(
        service.verifyRegistration('test@example.com', {}),
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

      credentialRepo.create = jest.fn().mockReturnValue(mockCredential);
      credentialRepo.save = jest.fn().mockResolvedValue(mockCredential);

      const result = await service.saveCredential(
        'user-1',
        mockVerification as any,
        'My Passkey',
      );

      expect(result).toEqual(mockCredential);
      expect(credentialRepo.save).toHaveBeenCalled();
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

      credentialRepo.create = jest.fn().mockReturnValue(mockCredential);
      credentialRepo.save = jest.fn().mockResolvedValue(mockCredential);

      await service.saveCredential('user-1', mockVerification as any);

      expect(credentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          friendlyName: 'This device',
        }),
      );
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

      credentialRepo.create = jest.fn().mockReturnValue(mockCredential);
      credentialRepo.save = jest.fn().mockResolvedValue(mockCredential);

      await service.saveCredential('user-1', mockVerification as any);

      expect(credentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          friendlyName: 'Synced passkey',
        }),
      );
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

      credentialRepo.create = jest.fn().mockReturnValue(mockCredential);
      credentialRepo.save = jest.fn().mockResolvedValue(mockCredential);

      await service.saveCredential('user-1', mockVerification as any);

      expect(credentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          friendlyName: 'Passkey',
        }),
      );
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('should generate authentication options without email', async () => {
      const mockOptions = { challenge: 'auth-challenge' };

      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      challengeRepo.create = jest.fn().mockReturnValue({});
      challengeRepo.save = jest.fn().mockResolvedValue({});

      const result = await service.generateAuthenticationOptions();

      expect(result.options).toEqual(mockOptions);
      expect(result.identifier).toMatch(/^anon_/);
    });

    it('should generate authentication options with email', async () => {
      const mockOptions = { challenge: 'auth-challenge' };

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockCredential]),
      };
      credentialRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      challengeRepo.create = jest.fn().mockReturnValue({});
      challengeRepo.save = jest.fn().mockResolvedValue({});

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

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      credentialRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      (
        simplewebauthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      challengeRepo.create = jest.fn().mockReturnValue({});
      challengeRepo.save = jest.fn().mockResolvedValue({});

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

      challengeRepo.findOne = jest.fn().mockResolvedValue(mockChallenge);
      credentialRepo.findOne = jest.fn().mockResolvedValue(mockCredential);
      (
        simplewebauthn.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue(mockVerification);
      credentialRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

      const result = await service.verifyAuthentication('test@example.com', {
        id: mockCredential.credentialId,
      });

      expect(result.verification).toEqual(mockVerification);
      expect(result.user).toBeDefined();
      expect(credentialRepo.update).toHaveBeenCalled();
    });

    it('should throw error when challenge not found', async () => {
      challengeRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.verifyAuthentication('test@example.com', { id: 'cred-id' }),
      ).rejects.toThrow('Challenge not found or expired');
    });

    it('should throw error when credential not found', async () => {
      challengeRepo.findOne = jest.fn().mockResolvedValue(mockChallenge);
      credentialRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.verifyAuthentication('test@example.com', {
          id: 'unknown-cred',
        }),
      ).rejects.toThrow('Credential not found');
    });

    it('should not update counter when verification fails', async () => {
      const mockVerification = {
        verified: false,
        authenticationInfo: { newCounter: 1 },
      };

      challengeRepo.findOne = jest.fn().mockResolvedValue(mockChallenge);
      credentialRepo.findOne = jest.fn().mockResolvedValue(mockCredential);
      (
        simplewebauthn.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue(mockVerification);

      const result = await service.verifyAuthentication('test@example.com', {
        id: mockCredential.credentialId,
      });

      expect(result.verification.verified).toBe(false);
      expect(credentialRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('getUserCredentials', () => {
    it('should return user credentials', async () => {
      credentialRepo.find = jest.fn().mockResolvedValue([mockCredential]);

      const result = await service.getUserCredentials('user-1');

      expect(result).toEqual([mockCredential]);
      expect(credentialRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('deleteCredential', () => {
    it('should delete credential successfully', async () => {
      credentialRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

      const result = await service.deleteCredential('cred-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should return false when credential not found', async () => {
      credentialRepo.delete = jest.fn().mockResolvedValue({ affected: 0 });

      const result = await service.deleteCredential('unknown-cred', 'user-1');

      expect(result).toBe(false);
    });
  });

  describe('userHasPasskeys', () => {
    it('should return true when user has passkeys', async () => {
      credentialRepo.count = jest.fn().mockResolvedValue(2);

      const result = await service.userHasPasskeys('user-1');

      expect(result).toBe(true);
    });

    it('should return false when user has no passkeys', async () => {
      credentialRepo.count = jest.fn().mockResolvedValue(0);

      const result = await service.userHasPasskeys('user-1');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredChallenges', () => {
    it('should cleanup expired challenges', async () => {
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 5 });

      const result = await service.cleanupExpiredChallenges();

      expect(result).toBe(5);
    });

    it('should return 0 when no challenges expired', async () => {
      challengeRepo.delete = jest.fn().mockResolvedValue({ affected: 0 });

      const result = await service.cleanupExpiredChallenges();

      expect(result).toBe(0);
    });
  });
});
