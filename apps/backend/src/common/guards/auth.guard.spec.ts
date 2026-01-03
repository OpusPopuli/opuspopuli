import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Mock GqlExecutionContext
jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockReflector: Partial<Reflector>;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    guard = new AuthGuard(mockReflector as Reflector);
    jest.clearAllMocks();
  });

  const createMockContext = (user: unknown) => {
    const mockRequest = { user, headers: {} };
    const mockGqlContext = {
      getContext: () => ({ req: mockRequest }),
      getInfo: () => ({
        fieldName: 'testField',
        parentType: { name: 'Query' },
      }),
    };

    (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

    // Create a minimal ExecutionContext mock
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    return context;
  };

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    describe('public routes', () => {
      it('should allow access when @Public() decorator is present', async () => {
        (mockReflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

        const context = createMockContext(null);

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(
          IS_PUBLIC_KEY,
          [context.getHandler(), context.getClass()],
        );
      });
    });

    describe('protected routes', () => {
      it('should return false when user is null', async () => {
        const context = createMockContext(null);

        const result = await guard.canActivate(context);

        expect(result).toBe(false);
      });

      it('should return false when user is undefined', async () => {
        const context = createMockContext(undefined);

        const result = await guard.canActivate(context);

        expect(result).toBe(false);
      });

      it('should return true for valid logged in user', async () => {
        const validUser = {
          id: 'user-123',
          email: 'test@example.com',
          roles: ['User'],
          department: 'Engineering',
          clearance: 'Secret',
        };

        const context = createMockContext(validUser);

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
      });

      it('should return false for user missing required fields', async () => {
        const invalidUser = {
          id: 'user-123',
          email: 'test@example.com',
          // missing roles, department, clearance
        };

        const context = createMockContext(invalidUser);

        const result = await guard.canActivate(context);

        expect(result).toBe(false);
      });

      it('should return false for user with only email', async () => {
        const partialUser = {
          email: 'test@example.com',
        };

        const context = createMockContext(partialUser);

        const result = await guard.canActivate(context);

        expect(result).toBe(false);
      });

      it('should return false for non-object user value', async () => {
        const context = createMockContext('not-an-object');

        const result = await guard.canActivate(context);

        expect(result).toBe(false);
      });
    });
  });

  describe('security: deny by default', () => {
    it('should deny access when no user is present on request', async () => {
      const context = createMockContext(null);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

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
            roles: ['Admin'],
            department: 'Engineering',
            clearance: 'TopSecret',
          }),
        },
      };

      const mockGqlContext = {
        getContext: () => ({ req: mockRequest }),
        getInfo: () => ({
          fieldName: 'testField',
          parentType: { name: 'Query' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const context = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;

      const result = await guard.canActivate(context);

      // Should deny because request.user is null, ignoring spoofed headers.user
      expect(result).toBe(false);
    });
  });
});
