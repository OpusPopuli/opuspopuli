import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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

    // Create a minimal ExecutionContext mock (GraphQL context type)
    const context = {
      getType: () => 'graphql',
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
      it('should throw UnauthorizedException when user is null', async () => {
        const context = createMockContext(null);

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('should throw UnauthorizedException when user is undefined', async () => {
        const context = createMockContext(undefined);

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
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

      it('should throw UnauthorizedException for user missing required fields', async () => {
        const invalidUser = {
          id: 'user-123',
          email: 'test@example.com',
          // missing roles, department, clearance
        };

        const context = createMockContext(invalidUser);

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('should throw UnauthorizedException for user with only email', async () => {
        const partialUser = {
          email: 'test@example.com',
        };

        const context = createMockContext(partialUser);

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('should throw UnauthorizedException for non-object user value', async () => {
        const context = createMockContext('not-an-object');

        await expect(guard.canActivate(context)).rejects.toThrow(
          UnauthorizedException,
        );
      });
    });
  });

  describe('federation/introspection queries', () => {
    const createFederationContext = (
      fieldName: string,
      hasHmacAuth: boolean,
    ) => {
      const mockRequest = {
        user: null,
        headers: hasHmacAuth ? { 'x-hmac-auth': 'HMAC ...' } : {},
      };
      const mockGqlContext = {
        getContext: () => ({ req: mockRequest }),
        getInfo: () => ({
          fieldName,
          parentType: { name: 'Query' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      return {
        getType: () => 'graphql',
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;
    };

    it('should allow __schema introspection from HMAC-authenticated gateway', async () => {
      const context = createFederationContext('__schema', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow __type introspection from HMAC-authenticated gateway', async () => {
      const context = createFederationContext('__type', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow _service federation query from HMAC-authenticated gateway', async () => {
      const context = createFederationContext('_service', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow _entities federation query from HMAC-authenticated gateway', async () => {
      const context = createFederationContext('_entities', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should deny __schema introspection without HMAC authentication', async () => {
      const context = createFederationContext('__schema', false);
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should deny _service federation query without HMAC authentication', async () => {
      const context = createFederationContext('_service', false);
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('HMAC user forwarding', () => {
    const createHmacContext = (
      hmacAuth: string | undefined,
      userHeader: string | undefined,
      existingUser: unknown = undefined,
    ) => {
      const mockRequest: Record<string, unknown> = {
        user: existingUser,
        headers: {
          ...(hmacAuth ? { 'x-hmac-auth': hmacAuth } : {}),
          ...(userHeader ? { user: userHeader } : {}),
        },
      };
      const mockGqlContext = {
        getContext: () => ({ req: mockRequest }),
        getInfo: () => ({
          fieldName: 'syncRegionData',
          parentType: { name: 'Mutation' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      return {
        context: {
          getType: () => 'graphql',
          getHandler: jest.fn(),
          getClass: jest.fn(),
        } as unknown as ExecutionContext,
        request: mockRequest,
      };
    };

    const validUserJson = JSON.stringify({
      id: 'user-123',
      email: 'admin@example.com',
      roles: ['admin'],
      department: 'Engineering',
      clearance: 'Secret',
    });

    it('should parse user from HMAC-forwarded header', async () => {
      const { context, request } = createHmacContext('HMAC ...', validUserJson);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.user).toEqual(JSON.parse(validUserJson));
    });

    it('should deny when HMAC is present but user header is missing', async () => {
      const { context } = createHmacContext('HMAC ...', undefined);
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should deny when HMAC is present but user header is invalid JSON', async () => {
      const { context } = createHmacContext('HMAC ...', 'not-json');
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should NOT parse user header when HMAC is absent (spoofing prevention)', async () => {
      const { context } = createHmacContext(undefined, validUserJson);
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should not overwrite existing request.user', async () => {
      const existingUser = {
        id: 'existing-user',
        email: 'existing@example.com',
        roles: ['user'],
        department: 'HR',
        clearance: 'Public',
      };
      const { context, request } = createHmacContext(
        'HMAC ...',
        validUserJson,
        existingUser,
      );
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.user).toEqual(existingUser);
    });
  });

  describe('forwarded client metadata', () => {
    it('should use x-forwarded-for and x-original-user-agent in audit log on denial', async () => {
      const mockRequest = {
        user: null,
        ip: '172.18.0.21',
        headers: {
          'x-forwarded-for': '192.168.1.100',
          'x-original-user-agent': 'Mozilla/5.0 Chrome/120',
          'user-agent': 'minipass-fetch/3.0.5',
        },
      };
      const mockGqlContext = {
        getContext: () => ({ req: mockRequest }),
        getInfo: () => ({
          fieldName: 'myProfile',
          parentType: { name: 'Query' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

      const mockAuditLogService = { logSync: jest.fn() };
      const guardWithAudit = new AuthGuard(
        mockReflector as Reflector,
        mockAuditLogService as never,
      );

      const context = {
        getType: () => 'graphql',
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;

      await expect(guardWithAudit.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );

      // Audit still fires — it runs before the throw.
      expect(mockAuditLogService.logSync).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0 Chrome/120',
        }),
      );
    });
  });

  describe('security: deny by default', () => {
    it('should deny access when no user is present on request', async () => {
      const context = createMockContext(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
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
        getType: () => 'graphql',
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;

      // request.user is null and the spoofed headers.user has no HMAC signature:
      // UNAUTHENTICATED (not signed in), not FORBIDDEN.
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('non-GraphQL (REST) routes (#864)', () => {
    it('allows a REST request through without touching the GraphQL context', async () => {
      // /metrics (Prometheus), /health, /api/csrf reach this global guard as an
      // 'http' context. The guard governs GraphQL only, so it must defer to the
      // REST layer — not 403 every scrape.
      const context = {
        getType: () => 'http',
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      // Must short-circuit BEFORE building a GraphQL context or checking @Public.
      expect(GqlExecutionContext.create as jest.Mock).not.toHaveBeenCalled();
      expect(mockReflector.getAllAndOverride).not.toHaveBeenCalled();
    });
  });
});
