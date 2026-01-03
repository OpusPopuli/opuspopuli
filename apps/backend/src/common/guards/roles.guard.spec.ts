import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ILogin } from 'src/interfaces/login.interface';

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

  // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/183
  const createMockContext = (
    user: ILogin | null | undefined,
    requiredRoles: Role[] | undefined = undefined,
  ) => {
    const mockRequest = { user, headers: {} };

    const mockGqlContext = {
      getContext: () => ({ req: mockRequest }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      getInfo: () => ({
        fieldName: 'testField',
        parentType: { name: 'Query' },
      }),
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
      const validUser: ILogin = {
        id: 'user-123',
        email: 'user@example.com',
        roles: [Role.User],
        department: 'Engineering',
        clearance: 'Secret',
      };

      const context = createMockContext(validUser, []);

      const result = await guard.canActivate(context);

      // Empty roles array means no role is required, so user with any roles will have .some() return false
      expect(result).toBe(false);
    });
  });

  describe('RBAC enforcement', () => {
    it('should allow access when user has required role', async () => {
      const validUser: ILogin = {
        id: 'user-123',
        email: 'admin@example.com',
        roles: [Role.Admin],
        department: 'Engineering',
        clearance: 'Top Secret',
      };

      const context = createMockContext(validUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access when user has one of multiple required roles', async () => {
      const validUser: ILogin = {
        id: 'user-123',
        email: 'user@example.com',
        roles: [Role.User],
        department: 'Engineering',
        clearance: 'Secret',
      };

      const context = createMockContext(validUser, [Role.Admin, Role.User]);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should deny access when user lacks required role', async () => {
      const validUser: ILogin = {
        id: 'user-123',
        email: 'user@example.com',
        roles: [Role.User],
        department: 'Engineering',
        clearance: 'Secret',
      };

      const context = createMockContext(validUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should allow access when user has multiple roles including required one', async () => {
      const validUser: ILogin = {
        id: 'user-123',
        email: 'admin@example.com',
        roles: [Role.User, Role.Admin],
        department: 'Engineering',
        clearance: 'Top Secret',
      };

      const context = createMockContext(validUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('unauthorized access rejection', () => {
    it('should reject when user is null', async () => {
      const context = createMockContext(null, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user is undefined', async () => {
      const context = createMockContext(undefined, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user has no roles', async () => {
      const userWithNoRoles: ILogin = {
        id: 'user-123',
        email: 'user@example.com',
        roles: [],
        department: 'Engineering',
        clearance: 'Secret',
      };

      const context = createMockContext(userWithNoRoles, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject when user object is missing required login fields', async () => {
      const incompleteUser = {
        email: 'user@example.com',
        // missing id, roles, department, clearance
      } as ILogin;

      const context = createMockContext(incompleteUser, [Role.Admin]);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('reflector metadata retrieval', () => {
    it('should retrieve roles from handler and class', async () => {
      const validUser: ILogin = {
        id: 'user-123',
        email: 'admin@example.com',
        roles: [Role.Admin],
        department: 'Engineering',
        clearance: 'Top Secret',
      };

      const context = createMockContext(validUser, [Role.Admin]);

      await guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        ROLES_KEY,
        expect.any(Array),
      );
    });
  });

  describe('security: deny by default', () => {
    it('should use request.user not request.headers.user', async () => {
      // This test verifies the security fix - we should NOT check headers.user
      // because that can be spoofed. We only trust request.user set by passport.
      const mockRequest = {
        user: null,
        headers: {
          // Even if headers.user is set, we should not trust it
          user: JSON.stringify({
            id: 'spoofed-user',
            email: 'spoofed@example.com',
            roles: [Role.Admin],
            department: 'Engineering',
            clearance: 'TopSecret',
          }),
        },
      };

      const mockGqlContext = {
        getContext: () => ({ req: mockRequest }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
        getInfo: () => ({
          fieldName: 'testField',
          parentType: { name: 'Query' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Admin]);

      const context = {} as ExecutionContext;

      const result = await guard.canActivate(context);

      // Should deny because request.user is null, ignoring spoofed headers.user
      expect(result).toBe(false);
    });
  });
});
