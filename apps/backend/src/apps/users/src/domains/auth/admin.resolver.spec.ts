/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { createMock } from '@golevelup/ts-jest';

import { AdminResolver } from './admin.resolver';
import { AuthService } from './auth.service';
import { Role } from 'src/common/enums/role.enum';
import { GqlContext } from 'src/common/utils/graphql-context';

// Mock context for admin tests
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

describe('AdminResolver', () => {
  let resolver: AdminResolver;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminResolver,
        { provide: AuthService, useValue: createMock<AuthService>() },
      ],
    }).compile();

    resolver = module.get<AdminResolver>(AdminResolver);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolver should be defined', () => {
    expect(resolver).toBeDefined();
  });

  it('should confirm a user', async () => {
    authService.confirmUser = jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(true);
    });

    const mockContext = createMockContext();
    expect(await resolver.confirmUser('1', mockContext)).toBe(true);
    expect(authService.confirmUser).toHaveBeenCalledTimes(1);
  });

  it('should fail to confirm an unknown user', async () => {
    authService.confirmUser = jest.fn().mockImplementation((id: string) => {
      return Promise.resolve(false);
    });

    const mockContext = createMockContext();
    try {
      await resolver.confirmUser('1', mockContext);
    } catch (error) {
      expect(error.message).toEqual('User not confirmed!');
      expect(authService.confirmUser).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to confirm a user due to error', async () => {
    authService.confirmUser = jest.fn().mockImplementation((id: string) => {
      return Promise.reject(new Error('Failed confirm user!'));
    });

    const mockContext = createMockContext();
    try {
      await resolver.confirmUser('1', mockContext);
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

    const mockContext = createMockContext();
    expect(await resolver.addAdminPermission('1', mockContext)).toBe(true);
    expect(authService.addPermission).toHaveBeenCalledTimes(1);
  });

  it('should fail to add admin permission to an unknown user', async () => {
    authService.addPermission = jest
      .fn()
      .mockImplementation((id: string, role: Role) => {
        return Promise.resolve(false);
      });

    const mockContext = createMockContext();
    try {
      await resolver.addAdminPermission('1', mockContext);
    } catch (error) {
      expect(error.message).toEqual('Admin Permissions were not granted!');
      expect(authService.addPermission).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to add admin permission due to error', async () => {
    authService.addPermission = jest.fn().mockImplementation((id: string) => {
      return Promise.reject(new Error('Failed to add admin permissions!'));
    });

    const mockContext = createMockContext();
    try {
      await resolver.addAdminPermission('1', mockContext);
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

    const mockContext = createMockContext();
    expect(await resolver.removeAdminPermission('1', mockContext)).toBe(true);
    expect(authService.removePermission).toHaveBeenCalledTimes(1);
  });

  it('should fail to remove admin permission from an unknown user', async () => {
    authService.removePermission = jest
      .fn()
      .mockImplementation((id: string, role: Role) => {
        return Promise.resolve(false);
      });

    const mockContext = createMockContext();
    try {
      await resolver.removeAdminPermission('1', mockContext);
    } catch (error) {
      expect(error.message).toEqual('Admin Permissions were not revoked!');
      expect(authService.removePermission).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail to remove admin permission due to error', async () => {
    authService.removePermission = jest
      .fn()
      .mockImplementation((id: string) => {
        return Promise.reject(new Error('Failed to revoke admin permissions!'));
      });

    const mockContext = createMockContext();
    try {
      await resolver.removeAdminPermission('1', mockContext);
    } catch (error) {
      expect(error.message).toEqual('Failed to revoke admin permissions!');
      expect(authService.removePermission).toHaveBeenCalledTimes(1);
    }
  });
});
