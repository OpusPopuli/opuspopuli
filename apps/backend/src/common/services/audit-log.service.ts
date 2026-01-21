import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DbService } from '@qckstrt/relationaldb-provider';
import { IAuditLogCreate } from '../interfaces/audit.interface';
import { maskSensitiveData } from '../utils/pii-masker';
import { ILogger, LOGGER } from '@qckstrt/logging-provider';
import { AUDIT_CONFIG } from '../audit/audit.module';

// Helper to convert Record<string, unknown> to JSON-compatible type
type JsonValue = object | undefined;
const toJsonValue = (value: Record<string, unknown> | undefined): JsonValue => {
  return value as JsonValue;
};

// Type alias for audit log records returned from database
type AuditLog = Awaited<ReturnType<DbService['auditLog']['create']>>;

export interface AuditConfig {
  retentionDays: number;
  cleanupIntervalMs: number;
}

@Injectable()
export class AuditLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private readonly writeQueue: IAuditLogCreate[] = [];
  private isProcessing = false;
  private readonly batchSize = 100;
  private readonly flushInterval = 5000; // 5 seconds
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    @Optional() @Inject(LOGGER) private structuredLogger?: ILogger,
    @Optional()
    @Inject(AUDIT_CONFIG)
    private readonly config?: AuditConfig,
  ) {
    this.logger = new Logger(AuditLogService.name);
    this.startPeriodicFlush();
  }

  async onModuleInit(): Promise<void> {
    // Start retention cleanup if configured
    const retentionDays = this.config?.retentionDays ?? 90;
    if (retentionDays > 0) {
      this.startRetentionCleanup();
      // Run initial cleanup on startup
      await this.cleanupOldRecords();
    }
  }

  /**
   * Queue an audit log entry for non-blocking persistence
   */
  async log(entry: IAuditLogCreate): Promise<void> {
    // Mask sensitive data in input variables
    const maskedEntry = this.maskEntry(entry);
    this.writeQueue.push(maskedEntry);

    // Process immediately if queue is full
    if (this.writeQueue.length >= this.batchSize) {
      this.processQueue();
    }
  }

  /**
   * Synchronous logging for critical events (login failures, security events)
   */
  async logSync(entry: IAuditLogCreate): Promise<AuditLog> {
    const maskedEntry = this.maskEntry(entry);
    return this.db.auditLog.create({
      data: {
        action: maskedEntry.action,
        entityType: maskedEntry.entityType,
        entityId: maskedEntry.entityId,
        userId: maskedEntry.userId,
        userEmail: maskedEntry.userEmail,
        requestId: maskedEntry.requestId,
        ipAddress: maskedEntry.ipAddress,
        userAgent: maskedEntry.userAgent,
        operationName: maskedEntry.operationName,
        operationType: maskedEntry.operationType,
        resolverName: maskedEntry.resolverName,
        inputVariables: toJsonValue(maskedEntry.inputVariables),
        success: maskedEntry.success ?? true,
        statusCode: maskedEntry.statusCode,
        errorMessage: maskedEntry.errorMessage,
        previousValues: toJsonValue(maskedEntry.previousValues),
        newValues: toJsonValue(maskedEntry.newValues),
        durationMs: maskedEntry.durationMs,
        serviceName: maskedEntry.serviceName,
      },
    });
  }

  private maskEntry(entry: IAuditLogCreate): IAuditLogCreate {
    return {
      ...entry,
      inputVariables: entry.inputVariables
        ? (maskSensitiveData(entry.inputVariables) as Record<string, unknown>)
        : undefined,
      previousValues: entry.previousValues
        ? (maskSensitiveData(entry.previousValues) as Record<string, unknown>)
        : undefined,
      newValues: entry.newValues
        ? (maskSensitiveData(entry.newValues) as Record<string, unknown>)
        : undefined,
    };
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      if (this.writeQueue.length > 0) {
        this.processQueue();
      }
    }, this.flushInterval);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.writeQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const batch = this.writeQueue.splice(0, this.batchSize);

    try {
      // Use createMany for batch insert
      await this.db.auditLog.createMany({
        data: batch.map((entry) => ({
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          userId: entry.userId,
          userEmail: entry.userEmail,
          requestId: entry.requestId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          operationName: entry.operationName,
          operationType: entry.operationType,
          resolverName: entry.resolverName,
          inputVariables: toJsonValue(entry.inputVariables),
          success: entry.success ?? true,
          statusCode: entry.statusCode,
          errorMessage: entry.errorMessage,
          previousValues: toJsonValue(entry.previousValues),
          newValues: toJsonValue(entry.newValues),
          durationMs: entry.durationMs,
          serviceName: entry.serviceName,
        })),
      });

      this.structuredLogger?.debug(
        `Flushed ${batch.length} audit log entries`,
        'AuditLogService',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to persist audit logs: ${errorMessage}`,
        errorStack,
      );
      // Re-queue failed entries at the front
      this.writeQueue.unshift(...batch);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Flush remaining entries on application shutdown
   */
  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Process remaining queue entries
    while (this.writeQueue.length > 0) {
      await this.processQueue();
    }
  }

  /**
   * Start periodic retention cleanup
   */
  private startRetentionCleanup(): void {
    const intervalMs = this.config?.cleanupIntervalMs ?? 86400000; // 24 hours default
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldRecords();
    }, intervalMs);

    this.structuredLogger?.info(
      `Audit log retention cleanup scheduled every ${intervalMs / 3600000} hours`,
      'AuditLogService',
    );
  }

  /**
   * Delete audit log records older than retention period
   */
  async cleanupOldRecords(): Promise<number> {
    const retentionDays = this.config?.retentionDays ?? 90;
    if (retentionDays <= 0) {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const result = await this.db.auditLog.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate,
          },
        },
      });

      const deletedCount = result.count;

      if (deletedCount > 0) {
        this.structuredLogger?.info(
          `Cleaned up ${deletedCount} audit log records older than ${retentionDays} days`,
          'AuditLogService',
        );
      }

      return deletedCount;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to cleanup old audit logs: ${errorMessage}`);
      return 0;
    }
  }
}
