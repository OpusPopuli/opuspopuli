import { UserInputError } from '@nestjs/apollo';
import {
  getUserFromContext,
  getSessionTokenFromContext,
  createAuditContext,
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
