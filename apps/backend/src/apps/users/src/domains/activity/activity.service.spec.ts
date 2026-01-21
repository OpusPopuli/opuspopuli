import { Test, TestingModule } from '@nestjs/testing';

import { DbService } from '@qckstrt/relationaldb-provider';
import { createMockDbService } from '@qckstrt/relationaldb-provider/testing';
import { ActivityService } from './activity.service';
import { AuditAction } from 'src/common/enums/audit-action.enum';

describe('ActivityService', () => {
  let service: ActivityService;
  let mockDb: ReturnType<typeof createMockDbService>;

  const mockUserId = 'test-user-id';
  const mockSessionToken = 'mock-session-token-123';

  // Test mock objects - using complete types for database compatibility
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
    mockDb = createMockDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivityService, { provide: DbService, useValue: mockDb }],
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
      mockDb.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(mockDb.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: { timestamp: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('should set hasMore true when more items exist', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockDb.auditLog.count.mockResolvedValue(25);

      const result = await service.getActivityLog(mockUserId, 10, 0);

      expect(result.hasMore).toBe(true);
    });

    it('should apply action filters', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const filters = { actions: [AuditAction.LOGIN, AuditAction.LOGOUT] };
      await service.getActivityLog(mockUserId, 20, 0, filters);

      expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: mockUserId,
            action: { in: [AuditAction.LOGIN, AuditAction.LOGOUT] },
          }),
        }),
      );
    });

    it('should apply entityType filter', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([]);
      mockDb.auditLog.count.mockResolvedValue(0);

      const filters = { entityType: 'User' };
      await service.getActivityLog(mockUserId, 20, 0, filters);

      expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: 'User',
          }),
        }),
      );
    });

    it('should apply successOnly filter', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([]);
      mockDb.auditLog.count.mockResolvedValue(0);

      const filters = { successOnly: true };
      await service.getActivityLog(mockUserId, 20, 0, filters);

      expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            success: true,
          }),
        }),
      );
    });

    it('should parse desktop user agent correctly', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([mockAuditLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBe('desktop');
      expect(result.items[0].browser).toBe('Chrome');
    });

    it('should parse mobile user agent correctly', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([mockMobileAuditLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBe('mobile');
      expect(result.items[0].browser).toBe('Safari');
    });

    it('should parse tablet user agent correctly', async () => {
      mockDb.auditLog.findMany.mockResolvedValue([mockTabletAuditLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBe('tablet');
    });

    it('should handle missing user agent', async () => {
      const logWithoutUA = { ...mockAuditLog, userAgent: null };
      mockDb.auditLog.findMany.mockResolvedValue([logWithoutUA]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].deviceType).toBeUndefined();
      expect(result.items[0].browser).toBeUndefined();
    });

    it('should detect Firefox browser', async () => {
      const firefoxLog = {
        ...mockAuditLog,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/121.0',
      };
      mockDb.auditLog.findMany.mockResolvedValue([firefoxLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].browser).toBe('Firefox');
    });

    it('should detect Edge browser', async () => {
      const edgeLog = {
        ...mockAuditLog,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edge/121.0',
      };
      mockDb.auditLog.findMany.mockResolvedValue([edgeLog]);
      mockDb.auditLog.count.mockResolvedValue(1);

      const result = await service.getActivityLog(mockUserId, 20, 0);

      expect(result.items[0].browser).toBe('Edge');
    });
  });

  // ============================================
  // getSessions Tests
  // ============================================

  describe('getSessions', () => {
    it('should return active sessions', async () => {
      mockDb.userSession.findMany.mockResolvedValue([mockSession]);
      mockDb.userSession.count.mockResolvedValue(1);

      const result = await service.getSessions(mockUserId, mockSessionToken);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockDb.userSession.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId, isActive: true },
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      });
    });

    it('should include revoked sessions when flag is set', async () => {
      mockDb.userSession.findMany.mockResolvedValue([mockSession]);
      mockDb.userSession.count.mockResolvedValue(1);

      await service.getSessions(mockUserId, mockSessionToken, true);

      expect(mockDb.userSession.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      });
    });

    it('should mark current session correctly', async () => {
      mockDb.userSession.findMany.mockResolvedValue([
        mockSession,
        mockOtherSession,
      ]);
      mockDb.userSession.count.mockResolvedValue(2);

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
      mockDb.userSession.findFirst.mockResolvedValue(mockSession);

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
      mockDb.userSession.findFirst.mockResolvedValue(null);

      const result = await service.getSession(
        mockUserId,
        'non-existent',
        mockSessionToken,
      );

      expect(result).toBeNull();
    });

    it('should mark isCurrent false for different token', async () => {
      mockDb.userSession.findFirst.mockResolvedValue(mockSession);

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
      mockDb.userSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revokeSession(
        mockUserId,
        'session-1',
        'user_logout',
      );

      expect(result).toBe(true);
      expect(mockDb.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', userId: mockUserId },
        data: expect.objectContaining({
          isActive: false,
          revokedReason: 'user_logout',
        }),
      });
    });

    it('should return false if session not found', async () => {
      mockDb.userSession.updateMany.mockResolvedValue({ count: 0 });

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
      mockDb.userSession.findMany.mockResolvedValue([
        mockSession,
        mockOtherSession,
      ]);
      mockDb.userSession.update.mockResolvedValue(mockOtherSession);

      const result = await service.revokeAllSessions(
        mockUserId,
        mockSessionToken,
        'user_logout_all',
      );

      expect(result).toBe(1);
      expect(mockDb.userSession.update).toHaveBeenCalledTimes(1);
      expect(mockDb.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-2' },
        data: expect.objectContaining({
          isActive: false,
          revokedReason: 'user_logout_all',
        }),
      });
    });

    it('should return 0 if no other sessions exist', async () => {
      mockDb.userSession.findMany.mockResolvedValue([mockSession]);

      const result = await service.revokeAllSessions(
        mockUserId,
        mockSessionToken,
        'user_logout_all',
      );

      expect(result).toBe(0);
    });

    it('should revoke all sessions if no current token provided', async () => {
      mockDb.userSession.findMany.mockResolvedValue([
        mockSession,
        mockOtherSession,
      ]);
      mockDb.userSession.update.mockResolvedValue(mockSession);

      const result = await service.revokeAllSessions(
        mockUserId,
        undefined,
        'admin_logout',
      );

      expect(result).toBe(2);
      expect(mockDb.userSession.update).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // getActivitySummary Tests
  // ============================================

  describe('getActivitySummary', () => {
    it('should return complete activity summary', async () => {
      mockDb.auditLog.count
        .mockResolvedValueOnce(100) // totalActions
        .mockResolvedValueOnce(95) // successfulActions
        .mockResolvedValueOnce(5); // failedActions

      mockDb.userSession.count.mockResolvedValue(2);

      mockDb.auditLog.findFirst
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
      mockDb.auditLog.count.mockResolvedValue(0);
      mockDb.userSession.count.mockResolvedValue(0);
      mockDb.auditLog.findFirst.mockResolvedValue(null);

      const result = await service.getActivitySummary(mockUserId);

      expect(result.totalActions).toBe(0);
      expect(result.lastLoginAt).toBeUndefined();
      expect(result.lastActivityAt).toBeUndefined();
    });
  });
});
