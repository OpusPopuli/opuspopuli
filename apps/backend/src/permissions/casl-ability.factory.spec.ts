import { Test, TestingModule } from '@nestjs/testing';
import { AnyMongoAbility, subject as an } from '@casl/ability';
import { CaslAbilityFactory } from './casl-ability.factory';
import { ILogin } from 'src/interfaces/login.interface';
import { IUser } from 'src/interfaces/user.interface';
import { Role } from 'src/common/enums/role.enum';
import { Action } from 'src/common/enums/action.enum';
import { Effect } from 'src/common/enums/effect.enum';
import { IPolicy } from 'src/interfaces/policy.interface';

describe('CaslAbilityFactory', () => {
  let factory: CaslAbilityFactory;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CaslAbilityFactory],
    }).compile();

    factory = module.get<CaslAbilityFactory>(CaslAbilityFactory);
  });

  it('should be defined', () => {
    expect(factory).toBeDefined();
  });

  describe('defineAbility', () => {
    const createUser = (roles: Role[] = [Role.User]): ILogin => ({
      id: 'user-123',
      email: 'test@example.com',
      roles,
      department: 'Engineering',
      clearance: 'Secret',
    });

    const createPolicy = (overrides: Partial<IPolicy> = {}): IPolicy => ({
      effect: Effect.Allow,
      actions: [Action.Read],
      subjects: ['User'],
      fields: [],
      conditions: {},
      ...overrides,
    });

    it('should grant admin users manage all permissions', async () => {
      const adminUser = createUser([Role.Admin]);
      const permissions: { subject: string; policies: IPolicy[] }[] = [];

      const ability = await factory.defineAbility(permissions, adminUser);

      expect(ability.can(Action.Manage, 'all')).toBe(true);
      expect(ability.can(Action.Read, 'User')).toBe(true);
      expect(ability.can(Action.Delete, 'User')).toBe(true);
    });

    it('should process allow policies', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({ effect: Effect.Allow, actions: [Action.Read] }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, regularUser);

      expect(ability.can(Action.Read, 'User')).toBe(true);
    });

    it('should process deny policies', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [Action.Read, Action.Delete],
            }),
            createPolicy({ effect: Effect.Deny, actions: [Action.Delete] }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, regularUser);

      expect(ability.can(Action.Read, 'User')).toBe(true);
      expect(ability.can(Action.Delete, 'User')).toBe(false);
    });

    it('should handle policies with fields', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [Action.Read],
              fields: ['email', 'username'],
            }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, regularUser);

      expect(ability.can(Action.Read, 'User', 'email')).toBe(true);
      expect(ability.can(Action.Read, 'User', 'password')).toBe(false);
    });

    it('should handle policies with conditions', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [Action.Update],
              conditions: { id: '{{id}}' },
            }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, regularUser);

      // Use the subject helper to properly type the subject
      const ownUser: IUser = { id: 'user-123', email: 'test@example.com' };
      const otherUser: IUser = { id: 'other-user', email: 'other@example.com' };

      // Should be able to update own user
      expect(ability.can(Action.Update, an('User', ownUser))).toBe(true);
      // Should not be able to update other users
      expect(ability.can(Action.Update, an('User', otherUser))).toBe(false);
    });

    it('should process File subject policies', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'File',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [
                Action.Create,
                Action.Read,
                Action.Update,
                Action.Delete,
              ],
              subjects: ['File'],
              conditions: { userId: '{{id}}' },
            }),
          ],
        },
      ];

      const ability = (await factory.defineAbility(
        permissions,
        regularUser,
      )) as unknown as AnyMongoAbility;

      expect(ability.can(Action.Read, an('File', { userId: 'user-123' }))).toBe(
        true,
      );
      expect(
        ability.can(Action.Create, an('File', { userId: 'user-123' })),
      ).toBe(true);
      expect(
        ability.can(Action.Read, an('File', { userId: 'other-user' })),
      ).toBe(false);
    });

    it('should process Knowledge subject policies', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'Knowledge',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [Action.Create, Action.Read],
              subjects: ['Knowledge'],
              conditions: { userId: '{{id}}' },
            }),
          ],
        },
      ];

      const ability = (await factory.defineAbility(
        permissions,
        regularUser,
      )) as unknown as AnyMongoAbility;

      expect(
        ability.can(Action.Read, an('Knowledge', { userId: 'user-123' })),
      ).toBe(true);
      expect(
        ability.can(Action.Create, an('Knowledge', { userId: 'user-123' })),
      ).toBe(true);
      expect(
        ability.can(Action.Delete, an('Knowledge', { userId: 'user-123' })),
      ).toBe(false);
      expect(
        ability.can(Action.Read, an('Knowledge', { userId: 'other-user' })),
      ).toBe(false);
    });

    it('should grant admin access to all subjects including File and Knowledge', async () => {
      const adminUser = createUser([Role.Admin]);
      const permissions: { subject: string; policies: IPolicy[] }[] = [];

      const ability = (await factory.defineAbility(
        permissions,
        adminUser,
      )) as unknown as AnyMongoAbility;

      expect(ability.can(Action.Manage, 'File')).toBe(true);
      expect(ability.can(Action.Manage, 'Knowledge')).toBe(true);
      expect(ability.can(Action.Delete, 'Knowledge')).toBe(true);
    });

    it('should handle empty permissions array', async () => {
      const regularUser = createUser([Role.User]);
      const permissions: { subject: string; policies: IPolicy[] }[] = [];

      const ability = await factory.defineAbility(permissions, regularUser);

      // Regular user with no policies should have no permissions
      expect(ability.can(Action.Read, 'User')).toBe(false);
    });

    it('should handle user with no roles', async () => {
      const userNoRoles = createUser([]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({ effect: Effect.Allow, actions: [Action.Read] }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, userNoRoles);

      expect(ability.can(Action.Read, 'User')).toBe(true);
      expect(ability.can(Action.Manage, 'all')).toBe(false);
    });

    it('should handle undefined roles', async () => {
      const userUndefinedRoles: ILogin = {
        id: 'user-123',
        email: 'test@example.com',
        roles: undefined as unknown as string[],
        department: 'Engineering',
        clearance: 'Secret',
      };

      const permissions: { subject: string; policies: IPolicy[] }[] = [];

      // Should not throw
      const ability = await factory.defineAbility(
        permissions,
        userUndefinedRoles,
      );
      expect(ability).toBeDefined();
    });

    it('should handle policies with empty fields array', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [Action.Read],
              fields: [],
            }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, regularUser);

      // With empty fields, all fields should be accessible
      expect(ability.can(Action.Read, 'User')).toBe(true);
    });

    it('should handle policies with empty conditions', async () => {
      const regularUser = createUser([Role.User]);
      const permissions = [
        {
          subject: 'User',
          policies: [
            createPolicy({
              effect: Effect.Allow,
              actions: [Action.Read],
              conditions: {},
            }),
          ],
        },
      ];

      const ability = await factory.defineAbility(permissions, regularUser);

      expect(ability.can(Action.Read, 'User')).toBe(true);
    });
  });

  describe('replacePlaceholders', () => {
    it('should replace simple placeholder', () => {
      const conditions = { userId: '{{id}}' };
      const values = { id: 'user-123' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({ userId: 'user-123' });
    });

    it('should replace nested path placeholder', () => {
      const conditions = { email: '{{user.email}}' };
      const values = { user: { email: 'test@example.com' } };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({ email: 'test@example.com' });
    });

    it('should handle nested objects in conditions', () => {
      const conditions = {
        outer: {
          inner: '{{value}}',
        },
      };
      const values = { value: 'replaced' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({
        outer: {
          inner: 'replaced',
        },
      });
    });

    it('should preserve non-string values', () => {
      const conditions = {
        active: true,
        count: 42,
        name: '{{name}}',
      };
      const values = { name: 'Test' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({
        active: true,
        count: 42,
        name: 'Test',
      });
    });

    it('should keep placeholder if value not found', () => {
      const conditions = { userId: '{{nonexistent}}' };
      const values = { id: 'user-123' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({ userId: '{{nonexistent}}' });
    });

    it('should handle multiple placeholders in same string', () => {
      const conditions = { query: '{{firstName}} {{lastName}}' };
      const values = { firstName: 'John', lastName: 'Doe' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({ query: 'John Doe' });
    });

    it('should handle empty conditions', () => {
      const conditions = {};
      const values = { id: 'user-123' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({});
    });

    it('should handle placeholder with spaces', () => {
      const conditions = { userId: '{{ id }}' };
      const values = { id: 'user-123' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({ userId: 'user-123' });
    });

    it('should handle deeply nested objects', () => {
      const conditions = {
        level1: {
          level2: {
            level3: '{{deep.value}}',
          },
        },
      };
      const values = { deep: { value: 'found' } };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: 'found',
          },
        },
      });
    });

    it('should handle null values in conditions', () => {
      const conditions = {
        nullValue: null,
        stringValue: '{{id}}',
      };
      const values = { id: 'user-123' };

      const result = factory.replacePlaceholders(conditions, values);

      expect(result).toEqual({
        nullValue: null,
        stringValue: 'user-123',
      });
    });
  });
});
