import { Injectable } from '@nestjs/common';
import {
  DbService,
  AuditLog as DbAuditLog,
  UserSession as DbUserSession,
} from '@qckstrt/relationaldb-provider';
import { AuditAction } from 'src/common/enums/audit-action.enum';

import {
  ActivityLogEntry,
  ActivityLogPage,
  ActivityLogFilters,
  SessionInfo,
  SessionsPage,
  ActivitySummary,
} from './dto/activity.dto';

@Injectable()
export class ActivityService {
  constructor(private readonly db: DbService) {}

  /**
   * Get paginated activity log for a user
   */
  async getActivityLog(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    filters?: ActivityLogFilters,
  ): Promise<ActivityLogPage> {
    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId };

    // Apply filters
    if (filters?.actions?.length) {
      where.action = { in: filters.actions };
    }
    if (filters?.entityType) {
      where.entityType = filters.entityType;
    }
    if (filters?.startDate) {
      where.timestamp = { gte: filters.startDate };
    }
    if (filters?.endDate) {
      where.timestamp = {
        ...where.timestamp,
        lte: filters.endDate,
      };
    }
    if (filters?.successOnly !== undefined) {
      where.success = filters.successOnly;
    }

    const [logs, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.auditLog.count({ where }),
    ]);

    const items: ActivityLogEntry[] = logs.map((log) =>
      this.mapAuditLogToEntry(log),
    );

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Get user's sessions
   */
  async getSessions(
    userId: string,
    currentSessionToken?: string,
    includeRevoked: boolean = false,
  ): Promise<SessionsPage> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId };

    if (!includeRevoked) {
      where.isActive = true;
    }

    const [sessions, total] = await Promise.all([
      this.db.userSession.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.db.userSession.count({ where }),
    ]);

    const items: SessionInfo[] = sessions.map((session) =>
      this.mapSessionToInfo(session, currentSessionToken),
    );

    return { items, total };
  }

  /**
   * Get a specific session
   */
  async getSession(
    userId: string,
    sessionId: string,
    currentSessionToken?: string,
  ): Promise<SessionInfo | null> {
    const session = await this.db.userSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return null;
    }

    return this.mapSessionToInfo(session, currentSessionToken);
  }

  /**
   * Revoke a session
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    reason: string = 'user_logout',
  ): Promise<boolean> {
    const result = await this.db.userSession.updateMany({
      where: { id: sessionId, userId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });

    return result.count > 0;
  }

  /**
   * Revoke all sessions except current
   */
  async revokeAllSessions(
    userId: string,
    exceptSessionToken?: string,
    reason: string = 'user_logout_all',
  ): Promise<number> {
    const sessions = await this.db.userSession.findMany({
      where: { userId, isActive: true },
    });

    let revokedCount = 0;
    for (const session of sessions) {
      if (session.sessionToken !== exceptSessionToken) {
        await this.db.userSession.update({
          where: { id: session.id },
          data: {
            isActive: false,
            revokedAt: new Date(),
            revokedReason: reason,
          },
        });
        revokedCount++;
      }
    }

    return revokedCount;
  }

  /**
   * Get activity summary for a user
   */
  async getActivitySummary(userId: string): Promise<ActivitySummary> {
    // Get action counts
    const [totalActions, successfulActions, failedActions, activeSessions] =
      await Promise.all([
        this.db.auditLog.count({ where: { userId } }),
        this.db.auditLog.count({ where: { userId, success: true } }),
        this.db.auditLog.count({ where: { userId, success: false } }),
        this.db.userSession.count({ where: { userId, isActive: true } }),
      ]);

    // Get last login
    const lastLogin = await this.db.auditLog.findFirst({
      where: { userId, action: AuditAction.LOGIN },
      orderBy: { timestamp: 'desc' },
    });

    // Get last activity
    const lastActivity = await this.db.auditLog.findFirst({
      where: { userId },
      orderBy: { timestamp: 'desc' },
    });

    return {
      totalActions,
      successfulActions,
      failedActions,
      activeSessions,
      lastLoginAt: lastLogin?.timestamp ?? undefined,
      lastActivityAt: lastActivity?.timestamp ?? undefined,
    };
  }

  /**
   * Parse user agent to extract device info
   */
  private parseUserAgent(userAgent?: string | null): {
    deviceType?: string;
    browser?: string;
  } {
    if (!userAgent) {
      return {};
    }

    let deviceType = 'desktop';
    if (/mobile/i.test(userAgent)) {
      deviceType = 'mobile';
    } else if (/tablet|ipad/i.test(userAgent)) {
      deviceType = 'tablet';
    }

    let browser: string | undefined;
    if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) {
      browser = 'Chrome';
    } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
      browser = 'Safari';
    } else if (/firefox/i.test(userAgent)) {
      browser = 'Firefox';
    } else if (/edge/i.test(userAgent)) {
      browser = 'Edge';
    }

    return { deviceType, browser };
  }

  private mapAuditLogToEntry(log: DbAuditLog): ActivityLogEntry {
    const { deviceType, browser } = this.parseUserAgent(log.userAgent);

    return {
      id: log.id,
      action: log.action as AuditAction,
      entityType: log.entityType ?? undefined,
      entityId: log.entityId ?? undefined,
      operationName: log.operationName ?? undefined,
      operationType: log.operationType ?? undefined,
      success: log.success,
      errorMessage: log.errorMessage ?? undefined,
      ipAddress: log.ipAddress ?? undefined,
      userAgent: log.userAgent ?? undefined,
      deviceType,
      browser,
      timestamp: log.timestamp,
    };
  }

  private mapSessionToInfo(
    session: DbUserSession,
    currentSessionToken?: string,
  ): SessionInfo {
    return {
      id: session.id,
      deviceType: session.deviceType ?? undefined,
      deviceName: session.deviceName ?? undefined,
      browser: session.browser ?? undefined,
      operatingSystem: session.operatingSystem ?? undefined,
      city: session.city ?? undefined,
      region: session.region ?? undefined,
      country: session.country ?? undefined,
      isActive: session.isActive,
      isCurrent: session.sessionToken === currentSessionToken,
      lastActivityAt: session.lastActivityAt ?? undefined,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt ?? undefined,
      revokedAt: session.revokedAt ?? undefined,
    };
  }
}
