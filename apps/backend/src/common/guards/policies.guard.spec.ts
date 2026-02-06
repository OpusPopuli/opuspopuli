import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PoliciesGuard } from './policies.guard';
import { CaslAbilityFactory } from '../../permissions/casl-ability.factory';
import { Action } from '../enums/action.enum';
import { Role } from 'src/common/enums/role.enum';
import { ILogin } from 'src/interfaces/login.interface';

// Mock GqlExecutionContext
jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('PoliciesGuard', () => {
  let guard: PoliciesGuard;
  let reflector: Reflector;
  let caslAbilityFactory: CaslAbilityFactory;

  const mockValidUser: ILogin = {
    id: 'user-123',
    email: 'test@example.com',
    roles: [Role.User],
    department: 'Engineering',
    clearance: 'Secret',
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;

    caslAbilityFactory = {
      defineAbility: jest.fn(),
      replacePlaceholders: jest.fn((conditions) => conditions),
    } as unknown as CaslAbilityFactory;

    guard = new PoliciesGuard(reflector, caslAbilityFactory);
    jest.clearAllMocks();
  });

  // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
  // @see https://github.com/OpusPopuli/opuspopuli/issues/183
  const createMockContext = (
    user: ILogin | null | undefined,
    args: Record<string, unknown> = {},
  ) => {
    const mockRequest = { user, headers: {} };
    const mockGqlContext = {
      getContext: () => ({ req: mockRequest }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      getArgs: () => args,
      getInfo: () => ({
        fieldName: 'testField',
        parentType: { name: 'Query' },
      }),
    };

    (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);

    return {} as ExecutionContext;
  };

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true when no policies are defined', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);
      const context = createMockContext(mockValidUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should return true when policies is null/undefined', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(null);
      const context = createMockContext(mockValidUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should return false when user is null', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
      ]);
      const context = createMockContext(null);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when user is undefined', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
      ]);
      const context = createMockContext(undefined);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when user is not logged in (missing required fields)', async () => {
      const invalidUser = { email: 'test@example.com' } as ILogin; // missing id, roles, etc.
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
      ]);
      const context = createMockContext(invalidUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should check policies for valid logged in user', async () => {
      const mockAbility = {
        can: jest.fn().mockReturnValue(true),
      };

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
      ]);
      (caslAbilityFactory.defineAbility as jest.Mock).mockResolvedValue(
        mockAbility,
      );

      const context = createMockContext(mockValidUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(caslAbilityFactory.defineAbility).toHaveBeenCalled();
      expect(mockAbility.can).toHaveBeenCalledWith(Action.Read, 'User');
    });

    it('should return false when user lacks permission', async () => {
      const mockAbility = {
        can: jest.fn().mockReturnValue(false),
      };

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Delete, subject: 'User' },
      ]);
      (caslAbilityFactory.defineAbility as jest.Mock).mockResolvedValue(
        mockAbility,
      );

      const context = createMockContext(mockValidUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should handle multiple policies (all must pass)', async () => {
      const mockAbility = {
        can: jest
          .fn()
          .mockReturnValueOnce(true) // First policy passes
          .mockReturnValueOnce(false), // Second policy fails
      };

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
        { action: Action.Update, subject: 'User' },
      ]);
      (caslAbilityFactory.defineAbility as jest.Mock).mockResolvedValue(
        mockAbility,
      );

      const context = createMockContext(mockValidUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should handle policies with conditions', async () => {
      const mockAbility = {
        can: jest.fn().mockReturnValue(true),
      };

      const policyWithConditions = {
        action: Action.Update,
        subject: 'User',
        conditions: { id: '{{id}}' },
      };

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        policyWithConditions,
      ]);
      (caslAbilityFactory.defineAbility as jest.Mock).mockResolvedValue(
        mockAbility,
      );
      (caslAbilityFactory.replacePlaceholders as jest.Mock).mockReturnValue({
        id: 'user-123',
      });

      const context = createMockContext(mockValidUser, { id: 'user-123' });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(caslAbilityFactory.replacePlaceholders).toHaveBeenCalled();
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
            roles: ['Admin'],
            department: 'Engineering',
            clearance: 'TopSecret',
          }),
        },
      };

      const mockGqlContext = {
        getContext: () => ({ req: mockRequest }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
        getArgs: () => ({}),
        getInfo: () => ({
          fieldName: 'testField',
          parentType: { name: 'Query' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
      ]);

      const context = {} as ExecutionContext;

      const result = await guard.canActivate(context);

      // Should deny because request.user is null, ignoring spoofed headers.user
      expect(result).toBe(false);
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
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
        getArgs: () => ({}),
        getInfo: () => ({
          fieldName,
          parentType: { name: 'Query' },
        }),
      };

      (GqlExecutionContext.create as jest.Mock).mockReturnValue(mockGqlContext);
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        { action: Action.Read, subject: 'User' },
      ]);

      return {} as ExecutionContext;
    };

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

    it('should allow __schema introspection from HMAC-authenticated gateway', async () => {
      const context = createFederationContext('__schema', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should deny _service federation query without HMAC authentication', async () => {
      const context = createFederationContext('_service', false);
      const result = await guard.canActivate(context);
      expect(result).toBe(false);
    });
  });
});
