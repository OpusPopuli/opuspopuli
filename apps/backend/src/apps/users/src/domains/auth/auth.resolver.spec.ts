/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { PasskeyService } from './services/passkey.service';
import { UsersService } from '../user/users.service';

import {
  changePasswordDto,
  confirmForgotPasswordDto,
  loginUserDto,
  registerUserDto,
} from '../../../../data.spec';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmForgotPasswordDto } from './dto/confirm-forgot-password.dto';
import { Role } from 'src/common/enums/role.enum';

describe('AuthResolver', () => {
  let resolver: AuthResolver;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthResolver,
        { provide: AuthService, useValue: createMock<AuthService>() },
        { provide: PasskeyService, useValue: createMock<PasskeyService>() },
        { provide: UsersService, useValue: createMock<UsersService>() },
      ],
    }).compile();

    resolver = module.get<AuthResolver>(AuthResolver);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolver and services should be defined', () => {
    expect(resolver).toBeDefined();
    expect(authService).toBeDefined();
  });

  it('should register a user', async () => {
    authService.registerUser = jest
      .fn()
      .mockImplementation((registerUserDto: RegisterUserDto) => {
        return Promise.resolve(true);
      });

    expect(await resolver.registerUser(registerUserDto)).toEqual(true);
    expect(authService.registerUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to register a user', async () => {
    authService.registerUser = jest
      .fn()
      .mockImplementation((registerUserDto: RegisterUserDto) => {
        return Promise.reject(new Error('Failed user registration!'));
      });

    try {
      await resolver.registerUser(registerUserDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user registration!');
      expect(authService.registerUser).toHaveBeenCalledTimes(1);
    }
  });

  it('should log in a user', async () => {
    authService.authenticateUser = jest
      .fn()
      .mockImplementation((loginUserDto: LoginUserDto) => {
        return Promise.resolve({
          accessToken: 'qwerty',
          idToken: 'q1w2e3',
          refreshToken: '123456',
        });
      });

    expect(await resolver.loginUser(loginUserDto)).toEqual({
      accessToken: 'qwerty',
      idToken: 'q1w2e3',
      refreshToken: '123456',
    });
    expect(authService.authenticateUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to log in a user', async () => {
    authService.authenticateUser = jest
      .fn()
      .mockImplementation((loginUserDto: LoginUserDto) => {
        return Promise.reject(new Error('Failed user login!'));
      });

    try {
      await resolver.loginUser(loginUserDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user login!');
      expect(authService.authenticateUser).toHaveBeenCalledTimes(1);
    }
  });

  it('should change a user password', async () => {
    authService.changePassword = jest
      .fn()
      .mockImplementation((id: string, changePassword: ChangePasswordDto) => {
        return Promise.resolve(true);
      });

    expect(await resolver.changePassword(changePasswordDto)).toBe(true);
    expect(authService.changePassword).toHaveBeenCalledTimes(1);
  });

  it('should fail to change a user password', async () => {
    authService.changePassword = jest
      .fn()
      .mockImplementation((id: string, changePassword: ChangePasswordDto) => {
        return Promise.reject(new Error('Failed user password change!'));
      });

    try {
      await resolver.changePassword(changePasswordDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user password change!');
      expect(authService.changePassword).toHaveBeenCalledTimes(1);
    }
  });

  it('should send a forgot user password', async () => {
    authService.forgotPassword = jest
      .fn()
      .mockImplementation((email: string) => {
        return Promise.resolve(true);
      });

    expect(await resolver.forgotPassword('email')).toBe(true);
    expect(authService.forgotPassword).toHaveBeenCalledTimes(1);
  });

  it('should confirm a forgot user password', async () => {
    authService.confirmForgotPassword = jest
      .fn()
      .mockImplementation((confirmForgotPassword: ConfirmForgotPasswordDto) => {
        return Promise.resolve(true);
      });

    expect(await resolver.confirmForgotPassword(confirmForgotPasswordDto)).toBe(
      true,
    );
    expect(authService.confirmForgotPassword).toHaveBeenCalledTimes(1);
  });

  it('should fail to confirm a forgot user password', async () => {
    authService.confirmForgotPassword = jest
      .fn()
      .mockImplementation((confirmForgotPassword: ConfirmForgotPasswordDto) => {
        return Promise.reject(new Error('Failed forgot user password change!'));
      });

    try {
      await resolver.confirmForgotPassword(confirmForgotPasswordDto);
    } catch (error) {
      expect(error.message).toEqual('Failed forgot user password change!');
      expect(authService.confirmForgotPassword).toHaveBeenCalledTimes(1);
    }
  });

  it('should confirm a user', async () => {
    authService.confirmUser = jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(true);
    });

    expect(await resolver.confirmUser('1')).toBe(true);
    expect(authService.confirmUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to confirm an unknown user', async () => {
    authService.confirmUser = jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(false);
    });

    try {
      await resolver.confirmUser('1');
    } catch (error) {
      expect(error.message).toEqual('User not confirmed!');
      expect(authService.confirmUser).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to confirm a user due to error', async () => {
    authService.confirmForgotPassword = jest
      .fn()
      .mockImplementation((id: string) => {
        return Promise.reject(new Error('Failed confirm user!'));
      });

    try {
      await resolver.confirmUser('1');
    } catch (error) {
      expect(error.message).toEqual('Failed confirm user!');
      expect(authService.confirmUser).toHaveBeenCalledTimes(1);
    }
  });

  it('should add admin permissions', async () => {
    authService.addPermission = jest
      .fn()
      .mockImplementation((id: string, role: Role) => {
        return Promise.resolve(true);
      });

    expect(await resolver.addAdminPermission('1')).toBe(true);
    expect(authService.addPermission).toHaveBeenCalledTimes(1);
  });

  it('should fail to add admin permission to an unknown user', async () => {
    authService.addPermission = jest
      .fn()
      .mockImplementation((id: string, role: Role) => {
        return Promise.resolve(false);
      });

    try {
      await resolver.addAdminPermission('1');
    } catch (error) {
      expect(error.message).toEqual('Admin Permissions were not granted!');
      expect(authService.addPermission).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to add admin permission due to error', async () => {
    authService.addPermission = jest.fn().mockImplementation((id: string) => {
      return Promise.reject(new Error('Failed to add admin permissions!'));
    });

    try {
      await resolver.addAdminPermission('1');
    } catch (error) {
      expect(error.message).toEqual('Failed to add admin permissions!');
      expect(authService.addPermission).toHaveBeenCalledTimes(1);
    }
  });

  it('should remove admin permissions', async () => {
    authService.removePermission = jest
      .fn()
      .mockImplementation((id: string, role: Role) => {
        return Promise.resolve(true);
      });

    expect(await resolver.removeAdminPermission('1')).toBe(true);
    expect(authService.removePermission).toHaveBeenCalledTimes(1);
  });

  it('should fail to remove admin permission from an unknown user', async () => {
    authService.removePermission = jest
      .fn()
      .mockImplementation((id: string, role: Role) => {
        return Promise.resolve(false);
      });

    try {
      await resolver.removeAdminPermission('1');
    } catch (error) {
      expect(error.message).toEqual('Admin Permissions were not revoked!');
      expect(authService.removePermission).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to add admin permission due to error', async () => {
    authService.removePermission = jest
      .fn()
      .mockImplementation((id: string) => {
        return Promise.reject(new Error('Failed to revoke admin permissions!'));
      });

    try {
      await resolver.removeAdminPermission('1');
    } catch (error) {
      expect(error.message).toEqual('Failed to revoke admin permissions!');
      expect(authService.removePermission).toHaveBeenCalledTimes(1);
    }
  });

  // ============================================
  // Passkey (WebAuthn) Tests
  // ============================================

  describe('generatePasskeyRegistrationOptions', () => {
    let passkeyService: PasskeyService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: UsersService, useValue: createMock<UsersService>() },
        ],
      }).compile();

      resolver = module.get<AuthResolver>(AuthResolver);
      authService = module.get<AuthService>(AuthService);
      passkeyService = module.get<PasskeyService>(PasskeyService);
    });

    it('should generate passkey registration options', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'Test',
      };
      const mockOptions = { challenge: 'abc123' };

      authService.getUserByEmail = jest.fn().mockResolvedValue(mockUser);
      passkeyService.generateRegistrationOptions = jest
        .fn()
        .mockResolvedValue(mockOptions);

      const result = await resolver.generatePasskeyRegistrationOptions({
        email: 'test@example.com',
      });

      expect(result).toEqual({ options: mockOptions });
      expect(authService.getUserByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should throw error when user not found', async () => {
      authService.getUserByEmail = jest.fn().mockResolvedValue(null);

      await expect(
        resolver.generatePasskeyRegistrationOptions({
          email: 'unknown@example.com',
        }),
      ).rejects.toThrow('User not found');
    });

    it('should throw error on failure', async () => {
      authService.getUserByEmail = jest
        .fn()
        .mockRejectedValue(new Error('Service error'));

      await expect(
        resolver.generatePasskeyRegistrationOptions({
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Service error');
    });
  });

  describe('verifyPasskeyRegistration', () => {
    let passkeyService: PasskeyService;
    let usersService: UsersService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: UsersService, useValue: createMock<UsersService>() },
        ],
      }).compile();

      resolver = module.get<AuthResolver>(AuthResolver);
      authService = module.get<AuthService>(AuthService);
      passkeyService = module.get<PasskeyService>(PasskeyService);
      usersService = module.get<UsersService>(UsersService);
    });

    it('should verify passkey registration successfully', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };

      authService.getUserByEmail = jest.fn().mockResolvedValue(mockUser);
      passkeyService.verifyRegistration = jest
        .fn()
        .mockResolvedValue({ verified: true });
      passkeyService.saveCredential = jest.fn().mockResolvedValue(undefined);
      usersService.updateAuthStrategy = jest.fn().mockResolvedValue(true);

      const result = await resolver.verifyPasskeyRegistration({
        email: 'test@example.com',
        response: {} as any,
        friendlyName: 'My Device',
      });

      expect(result).toBe(true);
      expect(passkeyService.saveCredential).toHaveBeenCalled();
      expect(usersService.updateAuthStrategy).toHaveBeenCalledWith(
        'user-1',
        'passkey',
      );
    });

    it('should return false when verification fails', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };

      authService.getUserByEmail = jest.fn().mockResolvedValue(mockUser);
      passkeyService.verifyRegistration = jest
        .fn()
        .mockResolvedValue({ verified: false });

      const result = await resolver.verifyPasskeyRegistration({
        email: 'test@example.com',
        response: {} as any,
      });

      expect(result).toBe(false);
    });

    it('should throw error when user not found', async () => {
      authService.getUserByEmail = jest.fn().mockResolvedValue(null);

      await expect(
        resolver.verifyPasskeyRegistration({
          email: 'unknown@example.com',
          response: {} as any,
        }),
      ).rejects.toThrow('User not found');
    });
  });

  describe('generatePasskeyAuthenticationOptions', () => {
    let passkeyService: PasskeyService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: UsersService, useValue: createMock<UsersService>() },
        ],
      }).compile();

      resolver = module.get<AuthResolver>(AuthResolver);
      passkeyService = module.get<PasskeyService>(PasskeyService);
    });

    it('should generate passkey authentication options', async () => {
      const mockResult = {
        options: { challenge: 'xyz' },
        identifier: 'session-1',
      };
      passkeyService.generateAuthenticationOptions = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await resolver.generatePasskeyAuthenticationOptions({
        email: 'test@example.com',
      });

      expect(result).toEqual(mockResult);
    });

    it('should work without input', async () => {
      const mockResult = {
        options: { challenge: 'xyz' },
        identifier: 'session-1',
      };
      passkeyService.generateAuthenticationOptions = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await resolver.generatePasskeyAuthenticationOptions();

      expect(result).toEqual(mockResult);
    });

    it('should throw error on failure', async () => {
      passkeyService.generateAuthenticationOptions = jest
        .fn()
        .mockRejectedValue(new Error('Auth options error'));

      await expect(
        resolver.generatePasskeyAuthenticationOptions({
          email: 'test@example.com',
        }),
      ).rejects.toThrow('Auth options error');
    });
  });

  describe('verifyPasskeyAuthentication', () => {
    let passkeyService: PasskeyService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: UsersService, useValue: createMock<UsersService>() },
        ],
      }).compile();

      resolver = module.get<AuthResolver>(AuthResolver);
      authService = module.get<AuthService>(AuthService);
      passkeyService = module.get<PasskeyService>(PasskeyService);
    });

    it('should verify passkey authentication successfully', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      const mockAuth = { accessToken: 'token', refreshToken: 'refresh' };

      passkeyService.verifyAuthentication = jest.fn().mockResolvedValue({
        verification: { verified: true },
        user: mockUser,
      });
      authService.generateTokensForUser = jest.fn().mockResolvedValue(mockAuth);

      const result = await resolver.verifyPasskeyAuthentication({
        identifier: 'session-1',
        response: {} as any,
      });

      expect(result).toEqual(mockAuth);
    });

    it('should throw error when verification fails', async () => {
      passkeyService.verifyAuthentication = jest.fn().mockResolvedValue({
        verification: { verified: false },
        user: null,
      });

      await expect(
        resolver.verifyPasskeyAuthentication({
          identifier: 'session-1',
          response: {} as any,
        }),
      ).rejects.toThrow('Passkey verification failed');
    });
  });

  describe('myPasskeys', () => {
    let passkeyService: PasskeyService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: UsersService, useValue: createMock<UsersService>() },
        ],
      }).compile();

      resolver = module.get<AuthResolver>(AuthResolver);
      passkeyService = module.get<PasskeyService>(PasskeyService);
    });

    it('should return user passkeys', async () => {
      const mockCredentials = [{ id: 'cred-1', friendlyName: 'Device 1' }];
      passkeyService.getUserCredentials = jest
        .fn()
        .mockResolvedValue(mockCredentials);

      const context = {
        req: { headers: { user: JSON.stringify({ id: 'user-1' }) } },
      };
      const result = await resolver.myPasskeys(context);

      expect(result).toEqual(mockCredentials);
    });

    it('should throw error when user not authenticated', async () => {
      const context = { req: { headers: { user: '' } } };

      await expect(resolver.myPasskeys(context)).rejects.toThrow(
        'User not authenticated',
      );
    });
  });

  describe('deletePasskey', () => {
    let passkeyService: PasskeyService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthResolver,
          { provide: AuthService, useValue: createMock<AuthService>() },
          { provide: PasskeyService, useValue: createMock<PasskeyService>() },
          { provide: UsersService, useValue: createMock<UsersService>() },
        ],
      }).compile();

      resolver = module.get<AuthResolver>(AuthResolver);
      passkeyService = module.get<PasskeyService>(PasskeyService);
    });

    it('should delete passkey successfully', async () => {
      passkeyService.deleteCredential = jest.fn().mockResolvedValue(true);

      const context = {
        req: { headers: { user: JSON.stringify({ id: 'user-1' }) } },
      };
      const result = await resolver.deletePasskey('cred-1', context);

      expect(result).toBe(true);
      expect(passkeyService.deleteCredential).toHaveBeenCalledWith(
        'cred-1',
        'user-1',
      );
    });

    it('should throw error when user not authenticated', async () => {
      const context = { req: { headers: { user: '' } } };

      await expect(resolver.deletePasskey('cred-1', context)).rejects.toThrow(
        'User not authenticated',
      );
    });
  });

  // ============================================
  // Magic Link Tests
  // ============================================

  describe('sendMagicLink', () => {
    it('should send magic link successfully', async () => {
      authService.sendMagicLink = jest.fn().mockResolvedValue(true);

      const result = await resolver.sendMagicLink({
        email: 'test@example.com',
        redirectTo: 'http://localhost',
      });

      expect(result).toBe(true);
      expect(authService.sendMagicLink).toHaveBeenCalledWith(
        'test@example.com',
        'http://localhost',
      );
    });

    it('should throw error on failure', async () => {
      authService.sendMagicLink = jest
        .fn()
        .mockRejectedValue(new Error('Send failed'));

      await expect(
        resolver.sendMagicLink({ email: 'test@example.com' }),
      ).rejects.toThrow('Send failed');
    });
  });

  describe('verifyMagicLink', () => {
    it('should verify magic link successfully', async () => {
      const mockAuth = { accessToken: 'token', refreshToken: 'refresh' };
      authService.verifyMagicLink = jest.fn().mockResolvedValue(mockAuth);

      const result = await resolver.verifyMagicLink({
        email: 'test@example.com',
        token: '123456',
      });

      expect(result).toEqual(mockAuth);
    });

    it('should throw error on failure', async () => {
      authService.verifyMagicLink = jest
        .fn()
        .mockRejectedValue(new Error('Verify failed'));

      await expect(
        resolver.verifyMagicLink({ email: 'test@example.com', token: 'bad' }),
      ).rejects.toThrow('Verify failed');
    });
  });

  describe('registerWithMagicLink', () => {
    it('should register with magic link successfully', async () => {
      authService.registerWithMagicLink = jest.fn().mockResolvedValue(true);

      const result = await resolver.registerWithMagicLink({
        email: 'new@example.com',
        redirectTo: 'http://localhost',
      });

      expect(result).toBe(true);
    });

    it('should throw error on failure', async () => {
      authService.registerWithMagicLink = jest
        .fn()
        .mockRejectedValue(new Error('Register failed'));

      await expect(
        resolver.registerWithMagicLink({ email: 'new@example.com' }),
      ).rejects.toThrow('Register failed');
    });
  });
});
