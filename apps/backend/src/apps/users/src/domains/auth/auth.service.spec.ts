/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { AuthService } from './auth.service';

import { UsersService } from '../user/users.service';
import { EmailService } from '../email/email.service';

import {
  users,
  loginUserDto,
  registerUserDto,
  changePasswordDto,
  confirmForgotPasswordDto,
} from '../../../../data.spec';
import { IAuthProvider } from '@opuspopuli/auth-provider';
import { Role } from 'src/common/enums/role.enum';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: UsersService;
  let authProvider: IAuthProvider;
  let emailService: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: createMock<UsersService>() },
        { provide: 'AUTH_PROVIDER', useValue: createMock<IAuthProvider>() },
        { provide: EmailService, useValue: createMock<EmailService>() },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    authProvider = module.get<IAuthProvider>('AUTH_PROVIDER');
    emailService = module.get<EmailService>(EmailService);
  });

  it('services should be defined', () => {
    expect(authService).toBeDefined();
    expect(usersService).toBeDefined();
    expect(authProvider).toBeDefined();
    expect(emailService).toBeDefined();
  });

  it('should register a user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.registerUser = jest
      .fn()
      .mockImplementation(
        (email: string, username: string, password: string) => {
          return Promise.resolve('0919390e-9061-70c5-6a92-2a0b70b204e7');
        },
      );
    emailService.sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);

    expect(await authService.registerUser(registerUserDto)).toEqual(
      '0919390e-9061-70c5-6a92-2a0b70b204e7',
    );
    expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
    expect(authProvider.registerUser).toHaveBeenCalledTimes(1);
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('should register a user with admin flag', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.registerUser = jest
      .fn()
      .mockResolvedValue('0919390e-9061-70c5-6a92-2a0b70b204e7');
    authProvider.addToGroup = jest.fn().mockResolvedValue(true);
    emailService.sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);

    const adminDto = { ...registerUserDto, admin: true };
    await authService.registerUser(adminDto);

    expect(authProvider.addToGroup).toHaveBeenCalledWith(
      adminDto.username,
      Role.Admin,
    );
  });

  it('should register a user with confirm flag', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.registerUser = jest
      .fn()
      .mockResolvedValue('0919390e-9061-70c5-6a92-2a0b70b204e7');
    authProvider.confirmUser = jest.fn().mockResolvedValue(true);
    emailService.sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);

    const confirmDto = { ...registerUserDto, confirm: true };
    await authService.registerUser(confirmDto);

    expect(authProvider.confirmUser).toHaveBeenCalledWith(confirmDto.username);
  });

  it('should handle welcome email failure gracefully', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.registerUser = jest
      .fn()
      .mockResolvedValue('0919390e-9061-70c5-6a92-2a0b70b204e7');
    emailService.sendWelcomeEmail = jest
      .fn()
      .mockRejectedValue(new Error('Email service unavailable'));

    // Should not throw, just log warning
    const result = await authService.registerUser(registerUserDto);
    expect(result).toEqual('0919390e-9061-70c5-6a92-2a0b70b204e7');
    expect(emailService.sendWelcomeEmail).toHaveBeenCalled();
  });

  it('should fail to register a user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.registerUser = jest
      .fn()
      .mockImplementation(
        (email: string, username: string, password: string) => {
          return Promise.reject(new Error('User already exists!'));
        },
      );

    try {
      await authService.registerUser(registerUserDto);
    } catch (error) {
      expect(error.message).toEqual('User already exists!');
      expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(authProvider.registerUser).toHaveBeenCalledTimes(1);
      expect(authProvider.addToGroup).toHaveBeenCalledTimes(0);
      expect(authProvider.confirmUser).toHaveBeenCalledTimes(0);
      expect(usersService.update).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to register a user due to bad cognito uuid', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.registerUser = jest
      .fn()
      .mockImplementation(
        (email: string, username: string, password: string) => {
          return Promise.resolve('bad-id');
        },
      );

    try {
      await authService.registerUser(registerUserDto);
    } catch (error) {
      expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(authProvider.registerUser).toHaveBeenCalledTimes(1);
      expect(authProvider.addToGroup).toHaveBeenCalledTimes(0);
      expect(authProvider.confirmUser).toHaveBeenCalledTimes(0);
      expect(usersService.update).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to register an unknown user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return null;
    });

    try {
      await authService.registerUser(registerUserDto);
    } catch (error) {
      expect(error.message).toContain('User does not exist!');
      expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(authProvider.registerUser).toHaveBeenCalledTimes(0);
      expect(authProvider.addToGroup).toHaveBeenCalledTimes(0);
      expect(authProvider.confirmUser).toHaveBeenCalledTimes(0);
      expect(usersService.update).toHaveBeenCalledTimes(0);
    }
  });

  it('should log in a user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.authenticateUser = jest
      .fn()
      .mockImplementation((email: string, password: string) => {
        return Promise.resolve({
          accessToken: 'qwerty',
          refreshToken: '123456',
        });
      });

    expect(await authService.authenticateUser(loginUserDto)).toEqual({
      accessToken: 'qwerty',
      refreshToken: '123456',
    });
    expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
    expect(authProvider.authenticateUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to log in a user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.authenticateUser = jest
      .fn()
      .mockImplementation((email: string, password: string) => {
        return Promise.reject(new Error('Failed user login!'));
      });

    try {
      await authService.authenticateUser(loginUserDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user login!');
      expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(authProvider.authenticateUser).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to log in an unknown user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return null;
    });

    try {
      await authService.authenticateUser(loginUserDto);
    } catch (error) {
      expect(error.message).toContain('User does not exist!');
      expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(authProvider.authenticateUser).toHaveBeenCalledTimes(0);
    }
  });

  it('should fail to log in a user', async () => {
    authProvider.changePassword = jest
      .fn()
      .mockImplementation(
        (id: string, currentPassword: string, newPassword: string) => {
          return Promise.reject(new Error('Failed user password change!'));
        },
      );

    try {
      await authService.changePassword(changePasswordDto);
    } catch (error) {
      expect(error.message).toEqual('Failed user password change!');
      expect(authProvider.changePassword).toHaveBeenCalledTimes(1);
    }
  });

  it('should change a user password', async () => {
    authProvider.changePassword = jest
      .fn()
      .mockImplementation(
        (id: string, currentPassword: string, newPassword: string) => {
          return Promise.resolve(true);
        },
      );

    expect(await authService.changePassword(changePasswordDto)).toBe(true);
    expect(authProvider.changePassword).toHaveBeenCalledTimes(1);
  });

  it('should send forgot user password', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.forgotPassword = jest
      .fn()
      .mockImplementation((email: string) => {
        return Promise.resolve(true);
      });

    expect(await authService.forgotPassword(users[0].email)).toBe(true);
    expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
    expect(authProvider.forgotPassword).toHaveBeenCalledTimes(1);
  });

  it('should send forgot user password if user not found', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return null;
    });

    expect(await authService.forgotPassword(users[0].email)).toBe(true);
    expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
    expect(authProvider.forgotPassword).toHaveBeenCalledTimes(0);
  });

  it('should confirm forgot user password', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return users.find((user) => user.email === email);
    });
    authProvider.confirmForgotPassword = jest
      .fn()
      .mockImplementation(
        (email: string, password: string, confirmationCode: string) => {
          return Promise.resolve(true);
        },
      );

    expect(
      await authService.confirmForgotPassword(confirmForgotPasswordDto),
    ).toBe(true);
    expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
    expect(authProvider.confirmForgotPassword).toHaveBeenCalledTimes(1);
  });

  it('should fail confirm forgot user password for unknown user', async () => {
    usersService.findByEmail = jest.fn().mockImplementation((email: string) => {
      return null;
    });

    expect(
      await authService.confirmForgotPassword(confirmForgotPasswordDto),
    ).toBe(true);
    expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
    expect(authProvider.confirmForgotPassword).toHaveBeenCalledTimes(0);
  });

  it('should confirm user', async () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return users.find((user) => user.id === id);
    });
    authProvider.confirmUser = jest
      .fn()
      .mockImplementation((username: string) => {
        return Promise.resolve(true);
      });

    expect(await authService.confirmUser(users[0].id)).toBe(true);
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(authProvider.confirmUser).toHaveBeenCalledTimes(1);
  });

  it('should fail confirm an unknown user', async () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return null;
    });

    expect(await authService.confirmUser(users[0].id)).toBe(false);
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(authProvider.confirmUser).toHaveBeenCalledTimes(0);
  });

  it('should add permissions', async () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return users.find((user) => user.id === id);
    });
    authProvider.addToGroup = jest
      .fn()
      .mockImplementation((username: string, group: Role) => {
        return Promise.resolve(true);
      });

    expect(await authService.addPermission(users[0].id, Role.Admin)).toBe(true);
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(authProvider.addToGroup).toHaveBeenCalledTimes(1);
  });

  it('should fail to add permissions for unknown user', async () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return null;
    });

    expect(await authService.addPermission(users[0].id, Role.Admin)).toBe(
      false,
    );
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(authProvider.addToGroup).toHaveBeenCalledTimes(0);
  });

  it('should remove permissions', async () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return users.find((user) => user.id === id);
    });
    authProvider.removeFromGroup = jest
      .fn()
      .mockImplementation((username: string, group: Role) => {
        return Promise.resolve(true);
      });

    expect(await authService.removePermission(users[0].id, Role.Admin)).toBe(
      true,
    );
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(authProvider.removeFromGroup).toHaveBeenCalledTimes(1);
  });

  it('should fail to remove permissions for unknown user', async () => {
    usersService.findById = jest.fn().mockImplementation((id: string) => {
      return null;
    });

    expect(await authService.removePermission(users[0].id, Role.Admin)).toBe(
      false,
    );
    expect(usersService.findById).toHaveBeenCalledTimes(1);
    expect(authProvider.removeFromGroup).toHaveBeenCalledTimes(0);
  });

  it('should delete a user', async () => {
    authProvider.deleteUser = jest
      .fn()
      .mockImplementation((username: string, group: Role) => {
        return Promise.resolve(true);
      });

    expect(await authService.deleteUser(users[0].email)).toBe(true);
    expect(authProvider.deleteUser).toHaveBeenCalledTimes(1);
  });

  // ============================================
  // Passwordless Authentication Tests
  // ============================================

  describe('getUserByEmail', () => {
    it('should return user when found', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(users[0]);

      const result = await authService.getUserByEmail(users[0].email);

      expect(result).toEqual(users[0]);
      expect(usersService.findByEmail).toHaveBeenCalledWith(users[0].email);
    });

    it('should return null when user not found', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(null);

      const result = await authService.getUserByEmail(
        'nonexistent@example.com',
      );

      expect(result).toBeNull();
    });
  });

  describe('sendMagicLink', () => {
    it('should send magic link for existing user', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(users[0]);
      (authProvider as any).sendMagicLink = jest.fn().mockResolvedValue(true);

      const result = await authService.sendMagicLink(
        users[0].email,
        'http://redirect.com',
      );

      expect(result).toBe(true);
      expect((authProvider as any).sendMagicLink).toHaveBeenCalledWith(
        users[0].email,
        'http://redirect.com',
      );
    });

    it('should return true for non-existent user (security)', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(null);

      const result = await authService.sendMagicLink('nonexistent@example.com');

      expect(result).toBe(true);
      expect((authProvider as any).sendMagicLink).not.toHaveBeenCalled();
    });

    it('should throw error if auth provider does not support magic link', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(users[0]);
      (authProvider as any).sendMagicLink = undefined;

      await expect(authService.sendMagicLink(users[0].email)).rejects.toThrow(
        'Magic link not supported by auth provider',
      );
    });
  });

  describe('verifyMagicLink', () => {
    it('should verify magic link and return auth tokens', async () => {
      const mockAuth = { accessToken: 'token', refreshToken: 'refresh' };
      usersService.findByEmail = jest.fn().mockResolvedValue(users[0]);
      (authProvider as any).verifyMagicLink = jest
        .fn()
        .mockResolvedValue(mockAuth);

      const result = await authService.verifyMagicLink(
        users[0].email,
        '123456',
      );

      expect(result).toEqual(mockAuth);
      expect((authProvider as any).verifyMagicLink).toHaveBeenCalledWith(
        users[0].email,
        '123456',
      );
    });

    it('should throw error when user not found', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(null);

      await expect(
        authService.verifyMagicLink('nonexistent@example.com', '123456'),
      ).rejects.toThrow('User not found');
    });

    it('should throw error if auth provider does not support magic link', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(users[0]);
      (authProvider as any).verifyMagicLink = undefined;

      await expect(
        authService.verifyMagicLink(users[0].email, '123456'),
      ).rejects.toThrow('Magic link not supported by auth provider');
    });
  });

  describe('registerWithMagicLink', () => {
    it('should send login magic link if user already exists', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(users[0]);
      (authProvider as any).sendMagicLink = jest.fn().mockResolvedValue(true);

      const result = await authService.registerWithMagicLink(
        users[0].email,
        'http://redirect.com',
      );

      expect(result).toBe(true);
      expect((authProvider as any).sendMagicLink).toHaveBeenCalled();
    });

    it('should create user and register with magic link for new user', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(null);
      usersService.createPasswordlessUser = jest.fn().mockResolvedValue({
        id: 'new-id',
        email: 'new@example.com',
      });
      (authProvider as any).registerWithMagicLink = jest
        .fn()
        .mockResolvedValue(true);
      emailService.sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);

      const result = await authService.registerWithMagicLink(
        'new@example.com',
        'http://redirect.com',
      );

      expect(result).toBe(true);
      expect(usersService.createPasswordlessUser).toHaveBeenCalledWith(
        'new@example.com',
      );
      expect((authProvider as any).registerWithMagicLink).toHaveBeenCalledWith(
        'new@example.com',
        'http://redirect.com',
      );
      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'new-id',
        'new@example.com',
      );
    });

    it('should handle welcome email failure gracefully in magic link registration', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(null);
      usersService.createPasswordlessUser = jest.fn().mockResolvedValue({
        id: 'new-id',
        email: 'new@example.com',
      });
      (authProvider as any).registerWithMagicLink = jest
        .fn()
        .mockResolvedValue(true);
      emailService.sendWelcomeEmail = jest
        .fn()
        .mockRejectedValue(new Error('Email failed'));

      // Should not throw, just log warning
      const result = await authService.registerWithMagicLink(
        'new@example.com',
        'http://redirect.com',
      );

      expect(result).toBe(true);
      expect(emailService.sendWelcomeEmail).toHaveBeenCalled();
    });

    it('should throw error if auth provider does not support magic link registration', async () => {
      usersService.findByEmail = jest.fn().mockResolvedValue(null);
      (authProvider as any).registerWithMagicLink = undefined;

      await expect(
        authService.registerWithMagicLink('new@example.com'),
      ).rejects.toThrow(
        'Magic link registration not supported by auth provider',
      );
    });
  });

  describe('generateTokensForUser', () => {
    it('should throw error when createSessionForUser not supported', async () => {
      (authProvider as any).createSessionForUser = undefined;

      await expect(
        authService.generateTokensForUser({ email: 'test@example.com' } as any),
      ).rejects.toThrow(
        'Token generation for passkey auth requires createSessionForUser support',
      );
    });

    it('should generate tokens successfully for passkey-authenticated user', async () => {
      const mockAuth = {
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      };
      (authProvider as any).createSessionForUser = jest
        .fn()
        .mockResolvedValue(mockAuth);

      const result = await authService.generateTokensForUser({
        email: 'test@example.com',
      } as any);

      expect(result).toEqual(mockAuth);
      expect((authProvider as any).createSessionForUser).toHaveBeenCalledWith(
        'test@example.com',
      );
    });
  });
});
