import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from 'src/db/prisma.service';
import { createMockPrismaService } from 'src/test/prisma-mock';
import { ActivityService } from './activity.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';

describe('ActivityService', () => {
  let service: ActivityService;
  let mockPrisma: ReturnType<typeof createMockPrismaService>;

  const mockUserId = 'test-user-id';
  const mockSessionToken = 'mock-session-token-123';

  // Test mock objects - using complete types for Prisma compatibility
  const mockAuditLog = {
    id: 'log-1',
    userId: mockUserId,
    userEmail: 'test@example.com',
    action: AuditAction.LOGIN,
    entityType: null,
    entityId: null,
    requestId: 'req-123',
    operationName: 'login',
    operationType: 'mutation',
    resolverName: 'login',
    inputVariables: null,
    previousValues: null,
    newValues: null,
    success: true,
    errorMessage: null,
    statusCode: 200,
    responseTime: 50,
    durationMs: 50,
    serviceName: 'users',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0.0.0',
    contextData: null,
    deletedAt: null,
    createdAt: new Date('2024-01-20T10:00:00Z'),
    timestamp: new Date('2024-01-20T10:00:00Z'),
  };

  const mockMobileAuditLog = {
    ...mockAuditLog,
    id: 'log-2',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/605.1.15',
  };

  const mockTabletAuditLog = {
    ...mockAuditLog,
    id: 'log-3',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari',
  };

  const mockSession = {
    id: 'session-1',
    userId: mockUserId,
    ipAddress: '192.168.1.1',
    sessionToken: mockSessionToken,
    refreshToken: null,
    deviceType: 'desktop',
    deviceName: 'MacBook Pro',
    browser: 'Chrome',
    operatingSystem: 'macOS',
    city: 'San Francisco',
    region: 'California',
    country: 'USA',
    isActive: true,
    lastActivityAt: new Date('2024-01-20T10:30:00Z'),
    createdAt: new Date('2024-01-15T08:00:00Z'),
    updatedAt: new Date('2024-01-20T10:30:00Z'),
    expiresAt: new Date('2024-02-15T08:00:00Z'),
    revokedAt: null,
    revokedReason: null,
  };

  const mockOtherSession = {
    ...mockSession,
    id: 'session-2',
    sessionToken: 'other-token',
    deviceName: 'iPhone',
    deviceType: 'mobile',
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ActivityService>(ActivityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // getActivityLog Tests
  // ============================================

  describe('getActivityLog', () => {
    it('should return paginated activity log', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: { timestamp: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('should set hasMore true when more items exist', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockPrisma.auditLog.count.mockResolvedValue(25);

      const result = await service.getActivityLog(mockUserId, 10, 0);

      expect(result.hasMore).toBe(true);
    });

    it('should apply action filters', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const filters = { actions: [AuditAction.LOGIN, AuditAction.LOGOUT] };
      await service.getActivityLog(mockUserId, 20, 0, filters);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: mockUserId,
            action: { in: [AuditAction.LOGIN, AuditAction.LOGOUT] },
          }),
        }),
      );
    });

    it('should apply entityType filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const filters = { entityType: 'User' };
      await service.getActivityLog(mockUserId, 20, 0, filters);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: 'User',
          }),
        }),
      );
    });

    it('should apply successOnly filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const filters = { successOnly: true };
      await service.getActivityLog(mockUserId, 20, 0, filters);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            success: true,
          }),
        }),
      );
    });

    it('should parse desktop user agent correctly', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBe('desktop');
      expect(result.items[0].browser).toBe('Chrome');
    });

    it('should parse mobile user agent correctly', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockMobileAuditLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBe('mobile');
      expect(result.items[0].browser).toBe('Safari');
    });

    it('should parse tablet user agent correctly', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([mockTabletAuditLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBe('tablet');
    });

    it('should handle missing user agent', async () => {
      const logWithoutUA = { ...mockAuditLog, userAgent: null };
      mockPrisma.auditLog.findMany.mockResolvedValue([logWithoutUA]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBeUndefined();
      expect(result.items[0].browser).toBeUndefined();
    });

    it('should detect Firefox browser', async () => {
      const firefoxLog = {
        ...mockAuditLog,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/121.0',
      };
      mockPrisma.auditLog.findMany.mockResolvedValue([firefoxLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].browser).toBe('Firefox');
    });

    it('should detect Edge browser', async () => {
      const edgeLog = {
        ...mockAuditLog,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edge/121.0',
      };
      mockPrisma.auditLog.findMany.mockResolvedValue([edgeLog]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].browser).toBe('Edge');
    });
  });

  // ============================================
  // getSessions Tests
  // ============================================

  describe('getSessions', () => {
    it('should return active sessions', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([mockSession]);
      mockPrisma.userSession.count.mockResolvedValue(1);

      const result = await service.getSessions(mockUserId, mockSessionToken);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId, isActive: true },
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      });
    });

    it('should include revoked sessions when flag is set', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([mockSession]);
      mockPrisma.userSession.count.mockResolvedValue(1);

      await service.getSessions(mockUserId, mockSessionToken, true);

      expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      });
    });

    it('should mark current session correctly', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([
        mockSession,
        mockOtherSession,
      ]);
      mockPrisma.userSession.count.mockResolvedValue(2);

      const result = await service.getSessions(mockUserId, mockSessionToken);

      expect(result.items[0].isCurrent).toBe(true);
      expect(result.items[1].isCurrent).toBe(false);
    });
  });

  // ============================================
  // getSession Tests
  // ============================================

  describe('getSession', () => {
    it('should return session by id', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(mockSession);

      const result = await service.getSession(
        mockUserId,
        'session-1',
        mockSessionToken,
      );

      expect(result).toBeDefined();
      expect(result!.id).toBe('session-1');
      expect(result!.isCurrent).toBe(true);
    });

    it('should return null for non-existent session', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(null);

      const result = await service.getSession(
        mockUserId,
        'non-existent',
        mockSessionToken,
      );

      expect(result).toBeNull();
    });

    it('should mark isCurrent false for different token', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(mockSession);

      const result = await service.getSession(
        mockUserId,
        'session-1',
        'different-token',
      );

      expect(result!.isCurrent).toBe(false);
    });
  });

  // ============================================
  // revokeSession Tests
  // ============================================

  describe('revokeSession', () => {
    it('should revoke session successfully', async () => {
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revokeSession(
        mockUserId,
        'session-1',
        'user_logout',
      );

      expect(result).toBe(true);
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', userId: mockUserId },
        data: expect.objectContaining({
          isActive: false,
          revokedReason: 'user_logout',
        }),
      });
    });

    it('should return false if session not found', async () => {
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.revokeSession(
        mockUserId,
        'non-existent',
        'user_logout',
      );

      expect(result).toBe(false);
    });
  });

  // ============================================
  // revokeAllSessions Tests
  // ============================================

  describe('revokeAllSessions', () => {
    it('should revoke all sessions except current', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([
        mockSession,
        mockOtherSession,
      ]);
      mockPrisma.userSession.update.mockResolvedValue(mockOtherSession);

      const result = await service.revokeAllSessions(
        mockUserId,
        mockSessionToken,
        'user_logout_all',
      );

      expect(result).toBe(1);
      expect(mockPrisma.userSession.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-2' },
        data: expect.objectContaining({
          isActive: false,
          revokedReason: 'user_logout_all',
        }),
      });
    });

    it('should return 0 if no other sessions exist', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([mockSession]);

      const result = await service.revokeAllSessions(
        mockUserId,
        mockSessionToken,
        'user_logout_all',
      );

      expect(result).toBe(0);
    });

    it('should revoke all sessions if no current token provided', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([
        mockSession,
        mockOtherSession,
      ]);
      mockPrisma.userSession.update.mockResolvedValue(mockSession);

      const result = await service.revokeAllSessions(
        mockUserId,
        undefined,
        'admin_logout',
      );

      expect(result).toBe(2);
      expect(mockPrisma.userSession.update).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // getActivitySummary Tests
  // ============================================

  describe('getActivitySummary', () => {
    it('should return complete activity summary', async () => {
      mockPrisma.auditLog.count
        .mockResolvedValueOnce(100) // totalActions
        .mockResolvedValueOnce(95) // successfulActions
        .mockResolvedValueOnce(5); // failedActions

      mockPrisma.userSession.count.mockResolvedValue(2);

      mockPrisma.auditLog.findFirst
        .mockResolvedValueOnce(mockAuditLog) // lastLogin
        .mockResolvedValueOnce(mockAuditLog); // lastActivity

      const result = await service.getActivitySummary(mockUserId);

      expect(result.totalActions).toBe(100);
      expect(result.successfulActions).toBe(95);
      expect(result.failedActions).toBe(5);
      expect(result.activeSessions).toBe(2);
      expect(result.lastLoginAt).toBeDefined();
      expect(result.lastActivityAt).toBeDefined();
    });

    it('should handle no login history', async () => {
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.userSession.count.mockResolvedValue(0);
      mockPrisma.auditLog.findFirst.mockResolvedValue(null);

      const result = await service.getActivitySummary(mockUserId);

      expect(result.totalActions).toBe(0);
      expect(result.lastLoginAt).toBeUndefined();
      expect(result.lastActivityAt).toBeUndefined();
    });
  });
});
