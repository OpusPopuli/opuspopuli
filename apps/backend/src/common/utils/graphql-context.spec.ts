import { UserInputError } from '@nestjs/apollo';
import {
  getUserFromContext,
  getSessionTokenFromContext,
  createAuditContext,
  tryReadFederatedUserId,
  GqlContext,
} from './graphql-context';
import { ILogin } from 'src/interfaces/login.interface';

describe('getUserFromContext', () => {
  const mockValidUser: ILogin = {
    id: 'user-123',
    email: 'test@example.com',
    roles: ['User'],
    department: 'Engineering',
    clearance: 'Secret',
  };

  it('should extract user from valid context', () => {
    const context: GqlContext = {
      req: {
        user: mockValidUser,
        headers: {},
      },
    };

    const result = getUserFromContext(context);

    expect(result).toEqual(mockValidUser);
  });

  it('should throw UserInputError when user is missing', () => {
    const context: GqlContext = {
      req: {
        headers: {},
      },
    };

    expect(() => getUserFromContext(context)).toThrow(UserInputError);
    expect(() => getUserFromContext(context)).toThrow('User not authenticated');
  });

  it('should throw UserInputError when user is undefined', () => {
    const context: GqlContext = {
      req: {
        user: undefined,
        headers: {},
      },
    };

    expect(() => getUserFromContext(context)).toThrow('User not authenticated');
  });

  describe('security: ignores headers.user', () => {
    it('should NOT trust headers.user - only req.user', () => {
      // This test verifies the security fix - we should NOT check headers.user
      // because that can be spoofed. We only trust request.user set by passport.
      const context = {
        req: {
          user: undefined,
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
        },
      } as unknown as GqlContext;

      // Should throw because request.user is undefined, ignoring spoofed headers.user
      expect(() => getUserFromContext(context)).toThrow(
        'User not authenticated',
      );
    });
  });
});

describe('tryReadFederatedUserId (opuspopuli#836 — @Public() federation auth)', () => {
  // Safe variant of getUserFromContext for field resolvers whose parent
  // query is @Public(). Mirrors AuthGuard's HMAC-then-user-header trust
  // model — see common/guards/auth.guard.ts lines 85-94. Returns
  // undefined on any miss instead of throwing.

  it('returns req.user.id when AuthMiddleware already populated it', () => {
    const context = {
      req: {
        user: { id: 'user-456' },
        headers: {},
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBe('user-456');
  });

  it('returns undefined when there is no user and no HMAC header (anonymous public query)', () => {
    const context = {
      req: { headers: {} },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBeUndefined();
  });

  it('returns undefined when HMAC is present but user header is missing', () => {
    const context = {
      req: { headers: { 'x-hmac-auth': 'sig=abc' } },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBeUndefined();
  });

  it('returns undefined when user header is present but HMAC is missing (defends against spoofed header)', () => {
    // SECURITY: matches AuthGuard's check — a user header WITHOUT a
    // valid HMAC signature is untrusted. Even though HMAC verification
    // happens upstream, the presence check is the gateway-origin proof.
    const context = {
      req: {
        headers: {
          user: JSON.stringify({ id: 'spoofed-user' }),
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBeUndefined();
  });

  it('returns the id from the user header when both HMAC and user are present', () => {
    const context = {
      req: {
        headers: {
          'x-hmac-auth': 'sig=abc',
          user: JSON.stringify({
            id: 'gateway-forwarded-user',
            email: 'u@example.com',
          }),
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBe('gateway-forwarded-user');
  });

  it('returns undefined when user header contains invalid JSON', () => {
    const context = {
      req: {
        headers: {
          'x-hmac-auth': 'sig=abc',
          user: '{not valid json',
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBeUndefined();
  });

  it('returns undefined when user header JSON parses but has no id field', () => {
    const context = {
      req: {
        headers: {
          'x-hmac-auth': 'sig=abc',
          user: JSON.stringify({ email: 'noId@example.com' }),
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBeUndefined();
  });

  it('returns undefined when user header JSON parses but id is not a string', () => {
    const context = {
      req: {
        headers: {
          'x-hmac-auth': 'sig=abc',
          user: JSON.stringify({ id: 12345 }),
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBeUndefined();
  });

  it('prefers req.user over the gateway-forwarded header even when both are present', () => {
    // If AuthMiddleware did populate req.user (e.g. this request actually
    // authenticated against the subgraph directly), it's the source of
    // truth — the gateway-forwarded header is just a fallback.
    const context = {
      req: {
        user: { id: 'middleware-user' },
        headers: {
          'x-hmac-auth': 'sig=abc',
          user: JSON.stringify({ id: 'header-user' }),
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBe('middleware-user');
  });

  it('handles array-valued headers (defensive against Express IncomingHttpHeaders shape)', () => {
    const context = {
      req: {
        headers: {
          'x-hmac-auth': ['sig=abc'],
          user: [JSON.stringify({ id: 'array-user' })],
        },
      },
    } as unknown as GqlContext;
    expect(tryReadFederatedUserId(context)).toBe('array-user');
  });
});

describe('getSessionTokenFromContext', () => {
  it('should extract token from Bearer authorization header', () => {
    const context: GqlContext = {
      req: {
        headers: {
          authorization: 'Bearer my-jwt-token',
        },
      },
    };

    const result = getSessionTokenFromContext(context);

    expect(result).toBe('my-jwt-token');
  });

  it('should handle case-insensitive Bearer prefix', () => {
    const context: GqlContext = {
      req: {
        headers: {
          authorization: 'bearer my-jwt-token',
        },
      },
    };

    const result = getSessionTokenFromContext(context);

    expect(result).toBe('my-jwt-token');
  });

  it('should return undefined when no authorization header', () => {
    const context: GqlContext = {
      req: {
        headers: {},
      },
    };

    const result = getSessionTokenFromContext(context);

    expect(result).toBeUndefined();
  });

  it('should return undefined when authorization header is empty', () => {
    const context: GqlContext = {
      req: {
        headers: {
          authorization: '',
        },
      },
    };

    const result = getSessionTokenFromContext(context);

    expect(result).toBeUndefined();
  });
});

describe('createAuditContext', () => {
  const mockUser: ILogin = {
    id: 'user-123',
    email: 'test@example.com',
    roles: ['User'],
    department: 'Engineering',
    clearance: 'Secret',
  };

  it('should create audit context from authenticated request', () => {
    const context: GqlContext = {
      req: {
        ip: '192.168.1.1',
        user: mockUser,
        headers: {
          'user-agent': 'TestAgent/1.0',
        },
      },
    };

    const result = createAuditContext(context, 'users-service');

    expect(result.requestId).toBeDefined();
    expect(result.userId).toBe('user-123');
    expect(result.userEmail).toBe('test@example.com');
    expect(result.ipAddress).toBe('192.168.1.1');
    expect(result.userAgent).toBe('TestAgent/1.0');
    expect(result.serviceName).toBe('users-service');
  });

  it('should use provided userEmail over context user email', () => {
    const context: GqlContext = {
      req: {
        user: mockUser,
        headers: {},
      },
    };

    const result = createAuditContext(
      context,
      'users-service',
      'override@example.com',
    );

    expect(result.userEmail).toBe('override@example.com');
  });

  it('should fall back to x-forwarded-for when ip is not available', () => {
    const context = {
      req: {
        user: mockUser,
        headers: {
          'x-forwarded-for': '10.0.0.1',
        },
      },
    } as unknown as GqlContext;

    const result = createAuditContext(context, 'users-service');

    expect(result.ipAddress).toBe('10.0.0.1');
  });

  it('should handle unauthenticated context gracefully', () => {
    const context: GqlContext = {
      req: {
        headers: {},
      },
    };

    const result = createAuditContext(context, 'users-service');

    expect(result.requestId).toBeDefined();
    expect(result.userId).toBeUndefined();
    expect(result.userEmail).toBeUndefined();
    expect(result.serviceName).toBe('users-service');
  });
});
