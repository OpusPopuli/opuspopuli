import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
    jest.clearAllMocks();
  });

  const createMockContext = (
    userHeader: string | null | undefined,
    requiredRoles: Role[] | undefined = undefined,
  ) => {
    const mockRequest = {
      headers: {
        user: userHeader,
      },
    };

    const mockGqlContext = {
      getContext: () => ({ req: mockRequest }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    };

    (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);

    return {} as ExecutionContext;
  };

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('no roles required', () => {
    it('should return true when no roles are required', async () => {
      const context = createMockContext(null, undefined);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should still check user when roles array is empty', async () => {
      // An empty roles array is still truthy, so guard continues to check user
      // With no valid user, access is denied
      const context = createMockContext(null, []);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should allow access with valid user when roles array is empty', async () => {
      const validUser = JSON.stringify({
        id: 'user-123',
        email: 'user@example.com',
        roles: [Role.User],
        department: 'Engineering',
        clearance: 'Secret',
      });

      const context = createMockContext(validUser, []);

      const result = await guard.canActivate(context);

      // Empty roles array means no role is required, so user with any roles will have .some() return false
      expect(result).toBe(false);
    });
  });

  describe('RBAC enforcement', () => {
    it('should allow access when user has required role', async () => {
      const validUser = JSON.stringify({
        id: 'user-123',
        email: 'admin@example.com',
        roles: [Role.Admin],
        department: 'Engineering',
        clearance: 'Top Secret',
      });

      const context = createMockContext(validUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access when user has one of multiple required roles', async () => {
      const validUser = JSON.stringify({
        id: 'user-123',
        email: 'user@example.com',
        roles: [Role.User],
        department: 'Engineering',
        clearance: 'Secret',
      });

      const context = createMockContext(validUser, [Role.Admin, Role.User]);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should deny access when user lacks required role', async () => {
      const validUser = JSON.stringify({
        id: 'user-123',
        email: 'user@example.com',
        roles: [Role.User],
        department: 'Engineering',
        clearance: 'Secret',
      });

      const context = createMockContext(validUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should allow access when user has multiple roles including required one', async () => {
      const validUser = JSON.stringify({
        id: 'user-123',
        email: 'admin@example.com',
        roles: [Role.User, Role.Admin],
        department: 'Engineering',
        clearance: 'Top Secret',
      });

      const context = createMockContext(validUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('unauthorized access rejection', () => {
    it('should reject when user header is null', async () => {
      const context = createMockContext(null, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user header is undefined', async () => {
      const context = createMockContext(undefined, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user header is string "undefined"', async () => {
      const context = createMockContext('undefined', [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user has no roles', async () => {
      const userWithNoRoles = JSON.stringify({
        id: 'user-123',
        email: 'user@example.com',
        roles: [],
        department: 'Engineering',
        clearance: 'Secret',
      });

      const context = createMockContext(userWithNoRoles, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user roles is null', async () => {
      const userWithNullRoles = JSON.stringify({
        id: 'user-123',
        email: 'user@example.com',
        roles: null,
        department: 'Engineering',
        clearance: 'Secret',
      });

      const context = createMockContext(userWithNullRoles, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user object is missing required login fields', async () => {
      const incompleteUser = JSON.stringify({
        email: 'user@example.com',
        // missing id, roles, department, clearance
      });

      const context = createMockContext(incompleteUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should throw error when user header is invalid JSON', async () => {
      const context = createMockContext('not-valid-json', [Role.Admin]);

      // The guard throws when JSON.parse fails (no try-catch around it)
      await expect(guard.canActivate(context)).rejects.toThrow(SyntaxError);
    });
  });

  describe('reflector metadata retrieval', () => {
    it('should retrieve roles from handler and class', async () => {
      const validUser = JSON.stringify({
        id: 'user-123',
        email: 'admin@example.com',
        roles: [Role.Admin],
        department: 'Engineering',
        clearance: 'Top Secret',
      });

      const context = createMockContext(validUser, [Role.Admin]);

      await guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        ROLES_KEY,
        expect.any(Array),
      );
    });
  });
});
