import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, isLoggedIn } from './jwt.strategy';
import { ILogin } from 'src/interfaces/login.interface';

describe('isLoggedIn', () => {
  it('should return true for valid login object', () => {
    const validLogin: ILogin = {
      id: 'user-123',
      email: 'test@example.com',
      roles: ['User'],
      department: 'Engineering',
      clearance: 'Secret',
    };

    expect(isLoggedIn(validLogin)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isLoggedIn(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isLoggedIn(undefined)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isLoggedIn('string')).toBe(false);
    expect(isLoggedIn(123)).toBe(false);
    expect(isLoggedIn(true)).toBe(false);
  });

  it('should return false for object missing email', () => {
    const invalidLogin = {
      id: 'user-123',
      roles: ['User'],
      department: 'Engineering',
      clearance: 'Secret',
    };

    expect(isLoggedIn(invalidLogin)).toBe(false);
  });

  it('should return false for object missing id', () => {
    const invalidLogin = {
      email: 'test@example.com',
      roles: ['User'],
      department: 'Engineering',
      clearance: 'Secret',
    };

    expect(isLoggedIn(invalidLogin)).toBe(false);
  });

  it('should return false for object missing roles', () => {
    const invalidLogin = {
      id: 'user-123',
      email: 'test@example.com',
      department: 'Engineering',
      clearance: 'Secret',
    };

    expect(isLoggedIn(invalidLogin)).toBe(false);
  });

  it('should return false for object missing department', () => {
    const invalidLogin = {
      id: 'user-123',
      email: 'test@example.com',
      roles: ['User'],
      clearance: 'Secret',
    };

    expect(isLoggedIn(invalidLogin)).toBe(false);
  });

  it('should return false for object missing clearance', () => {
    const invalidLogin = {
      id: 'user-123',
      email: 'test@example.com',
      roles: ['User'],
      department: 'Engineering',
    };

    expect(isLoggedIn(invalidLogin)).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isLoggedIn({})).toBe(false);
  });
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AUTH_JWT_SECRET') {
                return 'test-jwt-secret-at-least-32-characters-long';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    configService = module.get<ConfigService>(ConfigService);
  });

  it('should throw error when AUTH_JWT_SECRET is missing', () => {
    const badConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    expect(() => new JwtStrategy(badConfigService)).toThrow(
      'AUTH_JWT_SECRET is required for Supabase JWT validation',
    );
  });

  describe('validate', () => {
    beforeEach(() => {
      strategy = new JwtStrategy(configService);
    });

    it('should transform Supabase JWT payload to ILogin', async () => {
      const payload = {
        sub: 'user-uuid-123',
        email: 'test@example.com',
        app_metadata: {
          roles: ['Admin', 'User'],
        },
        user_metadata: {
          department: 'Engineering',
          clearance: 'TopSecret',
        },
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: 'user-uuid-123',
        email: 'test@example.com',
        roles: ['Admin', 'User'],
        department: 'Engineering',
        clearance: 'TopSecret',
      });
    });

    it('should handle missing app_metadata with empty roles', async () => {
      const payload = {
        sub: 'user-uuid-123',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result.roles).toEqual([]);
    });

    it('should handle missing user_metadata with empty strings', async () => {
      const payload = {
        sub: 'user-uuid-123',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: 'user-uuid-123',
        email: 'test@example.com',
        roles: [],
        department: '',
        clearance: '',
      });
    });
  });
});
