/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { UserInputError } from '@nestjs/apollo';

import { ActivityResolver } from './activity.resolver';
import { ActivityService } from './activity.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import { ILogin } from 'src/interfaces/login.interface';

describe('ActivityResolver', () => {
  let resolver: ActivityResolver;
  let activityService: ActivityService;

  const mockUserId = 'test-user-id';
  const mockUserEmail = 'test@example.com';
  const mockSessionToken = 'mock-session-token-123';

  const mockUser: ILogin = {
    id: mockUserId,
    email: mockUserEmail,
    roles: ['User'],
    department: 'Engineering',
    clearance: 'Secret',
  };

  // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
  // @see https://github.com/OpusPopuli/opuspopuli/issues/183
  const mockContext = {
    req: {
      ip: '127.0.0.1',
      user: mockUser,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        authorization: `Bearer ${mockSessionToken}`,
      },
    },
  };

  const mockContextNoUser = {
    req: {
      user: undefined,
      headers: {},
    },
  };

  const mockContextNoAuth = {
    req: {
      user: mockUser,
      headers: {},
    },
  };

  const mockActivityLogPage = {
    items: [
      {
        id: 'log-1',
        action: AuditAction.LOGIN,
        entityType: null,
        entityId: null,
        operationName: 'login',
        operationType: 'mutation',
        success: true,
        errorMessage: null,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        deviceType: 'desktop',
        browser: 'Chrome',
        timestamp: new Date('2024-01-20T10:00:00Z'),
      },
    ],
    total: 1,
    hasMore: false,
  };

  const mockActivitySummary = {
    totalActions: 100,
    successfulActions: 95,
    failedActions: 5,
    activeSessions: 2,
    lastLoginAt: new Date('2024-01-20T10:00:00Z'),
    lastActivityAt: new Date('2024-01-20T10:30:00Z'),
  };

  const mockSessionsPage = {
    items: [
      {
        id: 'session-1',
        deviceType: 'desktop',
        deviceName: 'MacBook Pro',
        browser: 'Chrome',
        operatingSystem: 'macOS',
        city: 'San Francisco',
        region: 'California',
        country: 'USA',
        isActive: true,
        isCurrent: true,
        lastActivityAt: new Date('2024-01-20T10:30:00Z'),
        createdAt: new Date('2024-01-15T08:00:00Z'),
        expiresAt: new Date('2024-02-15T08:00:00Z'),
        revokedAt: null,
      },
    ],
    total: 1,
  };

  const mockSession = mockSessionsPage.items[0];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityResolver,
        {
          provide: ActivityService,
          useValue: createMock<ActivityService>(),
        },
      ],
    }).compile();

    resolver = module.get<ActivityResolver>(ActivityResolver);
    activityService = module.get<ActivityService>(ActivityService);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  // ============================================
  // Activity Log Tests
  // ============================================

  describe('getMyActivityLog', () => {
    it('should return activity log for authenticated user', async () => {
      activityService.getActivityLog = jest
        .fn()
        .mockResolvedValue(mockActivityLogPage);

      const result = await resolver.getMyActivityLog(
        20,
        0,
        undefined as any,
        mockContext as any,
      );

      expect(result).toEqual(mockActivityLogPage);
      expect(activityService.getActivityLog).toHaveBeenCalledWith(
        mockUserId,
        20,
        0,
        undefined,
      );
    });

    it('should pass filters to service', async () => {
      const filters = { actions: [AuditAction.LOGIN], successOnly: true };
      activityService.getActivityLog = jest
        .fn()
        .mockResolvedValue(mockActivityLogPage);

      await resolver.getMyActivityLog(
        10,
        5,
        filters as any,
        mockContext as any,
      );

      expect(activityService.getActivityLog).toHaveBeenCalledWith(
        mockUserId,
        10,
        5,
        filters,
      );
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getMyActivityLog(
          20,
          0,
          undefined as any,
          mockContextNoUser as any,
        ),
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('getMyActivitySummary', () => {
    it('should return activity summary for authenticated user', async () => {
      activityService.getActivitySummary = jest
        .fn()
        .mockResolvedValue(mockActivitySummary);

      const result = await resolver.getMyActivitySummary(mockContext as any);

      expect(result).toEqual(mockActivitySummary);
      expect(activityService.getActivitySummary).toHaveBeenCalledWith(
        mockUserId,
      );
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getMyActivitySummary(mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  // ============================================
  // Session Tests
  // ============================================

  describe('getMySessions', () => {
    it('should return sessions for authenticated user', async () => {
      activityService.getSessions = jest
        .fn()
        .mockResolvedValue(mockSessionsPage);

      const result = await resolver.getMySessions(false, mockContext as any);

      expect(result).toEqual(mockSessionsPage);
      expect(activityService.getSessions).toHaveBeenCalledWith(
        mockUserId,
        mockSessionToken,
        false,
      );
    });

    it('should pass includeRevoked flag', async () => {
      activityService.getSessions = jest
        .fn()
        .mockResolvedValue(mockSessionsPage);

      await resolver.getMySessions(true, mockContext as any);

      expect(activityService.getSessions).toHaveBeenCalledWith(
        mockUserId,
        mockSessionToken,
        true,
      );
    });

    it('should handle missing authorization header', async () => {
      activityService.getSessions = jest
        .fn()
        .mockResolvedValue(mockSessionsPage);

      await resolver.getMySessions(false, mockContextNoAuth as any);

      expect(activityService.getSessions).toHaveBeenCalledWith(
        mockUserId,
        undefined,
        false,
      );
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getMySessions(false, mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('getMySession', () => {
    it('should return specific session', async () => {
      activityService.getSession = jest.fn().mockResolvedValue(mockSession);

      const result = await resolver.getMySession(
        'session-1',
        mockContext as any,
      );

      expect(result).toEqual(mockSession);
      expect(activityService.getSession).toHaveBeenCalledWith(
        mockUserId,
        'session-1',
        mockSessionToken,
      );
    });

    it('should return null for non-existent session', async () => {
      activityService.getSession = jest.fn().mockResolvedValue(null);

      const result = await resolver.getMySession(
        'non-existent',
        mockContext as any,
      );

      expect(result).toBeNull();
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getMySession('session-1', mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('revokeSession', () => {
    it('should revoke session', async () => {
      activityService.revokeSession = jest.fn().mockResolvedValue(true);

      const result = await resolver.revokeSession(
        'session-1',
        mockContext as any,
      );

      expect(result).toBe(true);
      expect(activityService.revokeSession).toHaveBeenCalledWith(
        mockUserId,
        'session-1',
        'user_logout',
      );
    });

    it('should return false if session not found', async () => {
      activityService.revokeSession = jest.fn().mockResolvedValue(false);

      const result = await resolver.revokeSession(
        'non-existent',
        mockContext as any,
      );

      expect(result).toBe(false);
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.revokeSession('session-1', mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('should revoke all other sessions', async () => {
      activityService.revokeAllSessions = jest.fn().mockResolvedValue(3);

      const result = await resolver.revokeAllOtherSessions(mockContext as any);

      expect(result).toBe(3);
      expect(activityService.revokeAllSessions).toHaveBeenCalledWith(
        mockUserId,
        mockSessionToken,
        'user_logout_all',
      );
    });

    it('should return 0 if no other sessions to revoke', async () => {
      activityService.revokeAllSessions = jest.fn().mockResolvedValue(0);

      const result = await resolver.revokeAllOtherSessions(mockContext as any);

      expect(result).toBe(0);
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.revokeAllOtherSessions(mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });
});
