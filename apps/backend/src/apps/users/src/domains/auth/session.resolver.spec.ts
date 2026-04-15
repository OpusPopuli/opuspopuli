/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';

import { SessionResolver } from './session.resolver';
import { AuthService } from './auth.service';
import { PasskeyService } from './services/passkey.service';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { ChangePasswordDto } from './dto/change-password.dto';
import { changePasswordDto } from '../../../../data.spec';
import { GqlContext } from 'src/common/utils/graphql-context';

// Mock context for tests that set cookies
const createMockContext = (): GqlContext => ({
  req: {
    user: undefined,
    headers: {},
    ip: '127.0.0.1',
  },
  res: {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response,
});

describe('SessionResolver', () => {
  let resolver: SessionResolver;
  let authService: AuthService;
  let passkeyService: PasskeyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionResolver,
        { provide: AuthService, useValue: createMock<AuthService>() },
        { provide: PasskeyService, useValue: createMock<PasskeyService>() },
        { provide: ConfigService, useValue: createMock<ConfigService>() },
        {
          provide: DbService,
          useValue: {
            userSession: {
              create: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          },
        },
      ],
    }).compile();

    resolver = module.get<SessionResolver>(SessionResolver);
    authService = module.get<AuthService>(AuthService);
    passkeyService = module.get<PasskeyService>(PasskeyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolver should be defined', () => {
    expect(resolver).toBeDefined();
  });

  it('should change a user password', async () => {
    authService.changePassword = jest
      .fn()
      .mockImplementation((id: string, changePassword: ChangePasswordDto) => {
        return Promise.resolve(true);
      });

    const mockContext = createMockContext();
    expect(await resolver.changePassword(changePasswordDto, mockContext)).toBe(
      true,
    );
    expect(authService.changePassword).toHaveBeenCalledTimes(1);
  });

  it('should fail to change a user password', async () => {
    authService.changePassword = jest
      .fn()
      .mockImplementation((id: string, changePassword: ChangePasswordDto) => {
        return Promise.reject(new Error('Failed user password change!'));
      });

    const mockContext = createMockContext();
    try {
      await resolver.changePassword(changePasswordDto, mockContext);
    } catch (error) {
      expect(error.message).toEqual('Failed user password change!');
      expect(authService.changePassword).toHaveBeenCalledTimes(1);
    }
  });

  describe('myPasskeys', () => {
    // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
    // @see https://github.com/OpusPopuli/opuspopuli/issues/183
    it('should return user passkeys', async () => {
      const mockCredentials = [{ id: 'cred-1', friendlyName: 'Device 1' }];
      passkeyService.getUserCredentials = jest
        .fn()
        .mockResolvedValue(mockCredentials);

      const context: GqlContext = {
        req: {
          user: {
            id: 'user-1',
            email: 'test@example.com',
            roles: ['User'],
            department: 'Engineering',
            clearance: 'Secret',
          },
          headers: {},
        },
      };
      const result = await resolver.myPasskeys(context);

      expect(result).toEqual(mockCredentials);
    });

    it('should throw error when user not authenticated', async () => {
      const context: GqlContext = { req: { user: undefined, headers: {} } };

      await expect(resolver.myPasskeys(context)).rejects.toThrow(
        'User not authenticated',
      );
    });
  });

  describe('deletePasskey', () => {
    // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
    // @see https://github.com/OpusPopuli/opuspopuli/issues/183
    it('should delete passkey successfully', async () => {
      passkeyService.deleteCredential = jest.fn().mockResolvedValue(true);

      const context: GqlContext = {
        req: {
          user: {
            id: 'user-1',
            email: 'test@example.com',
            roles: ['User'],
            department: 'Engineering',
            clearance: 'Secret',
          },
          headers: {},
        },
      };
      const result = await resolver.deletePasskey('cred-1', context);

      expect(result).toBe(true);
      expect(passkeyService.deleteCredential).toHaveBeenCalledWith(
        'cred-1',
        'user-1',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const context: GqlContext = { req: { user: undefined, headers: {} } };

      await expect(resolver.deletePasskey('cred-1', context)).rejects.toThrow(
        'User not authenticated',
      );
    });
  });

  describe('logout', () => {
    it('should clear cookies on logout', async () => {
      const mockContext = createMockContext();
      const result = await resolver.logout(mockContext);

      expect(result).toBe(true);
      // Verify cookies were cleared
      expect(mockContext.res?.clearCookie).toHaveBeenCalled();
    });

    it('should return true even without res object', async () => {
      const contextWithoutRes = {
        req: { user: undefined, headers: {} },
      } as GqlContext;
      const result = await resolver.logout(contextWithoutRes);

      expect(result).toBe(true);
    });

    it('should deactivate all active sessions on logout', async () => {
      const mockContext = createMockContext();
      mockContext.req.user = {
        id: 'user-123',
        email: 'test@example.com',
        roles: ['User'],
        department: '',
        clearance: '',
      };

      const module = await Test.createTestingModule({
        providers: [
          SessionResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: ConfigService, useValue: createMock<ConfigService>() },
          {
            provide: DbService,
            useValue: {
              userSession: {
                create: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 2 }),
              },
            },
          },
        ],
      }).compile();

      const logoutResolver = module.get<SessionResolver>(SessionResolver);
      const db = module.get<DbService>(DbService);

      await logoutResolver.logout(mockContext);

      expect(db.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', isActive: true },
        data: expect.objectContaining({
          isActive: false,
          revokedReason: 'user_logout',
        }),
      });
    });
  });
});
