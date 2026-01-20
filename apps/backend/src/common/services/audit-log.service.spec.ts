import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { AuditAction } from '../enums/audit-action.enum';
import { IAuditLogCreate } from '../interfaces/audit.interface';
import { LOGGER } from '@qckstrt/logging-provider';
import { AUDIT_CONFIG } from '../audit/audit.module';
import { PrismaService } from '../../db/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/prisma-mock';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let mockPrisma: MockPrismaService;

  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const defaultConfig = {
    retentionDays: 90,
    cleanupIntervalMs: 86400000,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: LOGGER,
          useValue: mockLogger,
        },
        {
          provide: AUDIT_CONFIG,
          useValue: defaultConfig,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    const createAuditEntry = (
      overrides: Partial<IAuditLogCreate> = {},
    ): IAuditLogCreate => ({
      requestId: 'req-123',
      serviceName: 'test-service',
      action: AuditAction.READ,
      success: true,
      ...overrides,
    });

    it('should queue audit log entry', async () => {
      const entry = createAuditEntry();

      await service.log(entry);

      // Entry should be queued, not immediately persisted
      expect(mockPrisma.auditLog.createMany).not.toHaveBeenCalled();
    });

    it('should mask sensitive data in input variables', async () => {
      const entry = createAuditEntry({
        inputVariables: {
          password: 'secret123',
          email: 'test@example.com',
          username: 'john',
        },
      });

      mockPrisma.auditLog.createMany.mockResolvedValue({ count: 1 });

      await service.log(entry);

      // Trigger flush
      jest.advanceTimersByTime(5001);
      await Promise.resolve();

      expect(mockPrisma.auditLog.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            inputVariables: expect.objectContaining({
              password: '[REDACTED]',
              username: 'john',
            }),
          }),
        ]),
      });
    });

    it('should process queue when batch size is reached', async () => {
      mockPrisma.auditLog.createMany.mockResolvedValue({ count: 100 });

      // Add 100 entries to trigger batch processing
      for (let i = 0; i < 100; i++) {
        await service.log(createAuditEntry({ requestId: `req-${i}` }));
      }

      // Should have triggered createMany
      await Promise.resolve();
      expect(mockPrisma.auditLog.createMany).toHaveBeenCalled();
    });
  });

  describe('logSync', () => {
    it('should immediately persist audit log', async () => {
      const entry: IAuditLogCreate = {
        requestId: 'req-123',
        serviceName: 'test-service',
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: 'Invalid credentials',
      };

      const mockEntity = {
        id: 'audit-1',
        requestId: entry.requestId,
        serviceName: entry.serviceName,
        action: entry.action,
        success: entry.success ?? false,
        errorMessage: entry.errorMessage ?? null,
        timestamp: new Date(),
        inputVariables: null,
        previousValues: null,
        newValues: null,
        entityType: null,
        entityId: null,
        userId: null,
        userEmail: null,
        ipAddress: null,
        userAgent: null,
        operationName: null,
        operationType: null,
        resolverName: null,
        statusCode: null,
        durationMs: null,
      };
      mockPrisma.auditLog.create.mockResolvedValue(mockEntity);

      const result = await service.logSync(entry);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: 'req-123',
          serviceName: 'test-service',
          action: AuditAction.LOGIN_FAILED,
          success: false,
          errorMessage: 'Invalid credentials',
        }),
      });
      expect(result).toBe(mockEntity);
    });

    it('should mask sensitive data in sync logs', async () => {
      const entry: IAuditLogCreate = {
        requestId: 'req-123',
        serviceName: 'test-service',
        action: AuditAction.LOGIN,
        success: true,
        inputVariables: { password: 'secret' },
      };

      const mockEntity = {
        id: 'audit-1',
        ...entry,
        timestamp: new Date(),
        inputVariables: { password: '[REDACTED]' },
        previousValues: null,
        newValues: null,
        entityType: null,
        entityId: null,
        userId: null,
        userEmail: null,
        ipAddress: null,
        userAgent: null,
        operationName: null,
        operationType: null,
        resolverName: null,
        statusCode: null,
        durationMs: null,
        errorMessage: null,
      };
      mockPrisma.auditLog.create.mockResolvedValue(mockEntity);

      await service.logSync(entry);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inputVariables: { password: '[REDACTED]' },
        }),
      });
    });
  });

  describe('periodic flush', () => {
    it('should flush queue periodically', async () => {
      mockPrisma.auditLog.createMany.mockResolvedValue({ count: 1 });

      await service.log({
        requestId: 'req-1',
        serviceName: 'test',
        action: AuditAction.READ,
        success: true,
      });

      // Advance timer to trigger flush
      jest.advanceTimersByTime(5001);
      await Promise.resolve();

      expect(mockPrisma.auditLog.createMany).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should flush remaining entries on shutdown', async () => {
      mockPrisma.auditLog.createMany.mockResolvedValue({ count: 1 });

      await service.log({
        requestId: 'req-1',
        serviceName: 'test',
        action: AuditAction.READ,
        success: true,
      });

      await service.onModuleDestroy();

      expect(mockPrisma.auditLog.createMany).toHaveBeenCalled();
    });
  });

  describe('retention cleanup', () => {
    it('should delete records older than retention period', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 50 });

      const deletedCount = await service.cleanupOldRecords();

      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: {
          timestamp: {
            lt: expect.any(Date),
          },
        },
      });
      expect(deletedCount).toBe(50);
    });

    it('should return 0 when no records deleted', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });

      const deletedCount = await service.cleanupOldRecords();

      expect(deletedCount).toBe(0);
    });

    it('should handle delete errors gracefully', async () => {
      mockPrisma.auditLog.deleteMany.mockRejectedValue(
        new Error('Database error'),
      );

      const deletedCount = await service.cleanupOldRecords();

      expect(deletedCount).toBe(0);
    });

    it('should run cleanup on module init', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 10 });

      await service.onModuleInit();

      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalled();
    });

    it('should log cleanup results when records deleted', async () => {
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 100 });

      await service.cleanupOldRecords();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 100 audit log records'),
        'AuditLogService',
      );
    });
  });

  describe('retention cleanup with zero retention', () => {
    let serviceWithNoRetention: AuditLogService;
    let mockPrismaNoRetention: MockPrismaService;

    beforeEach(async () => {
      mockPrismaNoRetention = createMockPrismaService();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuditLogService,
          {
            provide: PrismaService,
            useValue: mockPrismaNoRetention,
          },
          {
            provide: LOGGER,
            useValue: mockLogger,
          },
          {
            provide: AUDIT_CONFIG,
            useValue: { retentionDays: 0, cleanupIntervalMs: 86400000 },
          },
        ],
      }).compile();

      serviceWithNoRetention = module.get<AuditLogService>(AuditLogService);
    });

    afterEach(async () => {
      await serviceWithNoRetention.onModuleDestroy();
    });

    it('should skip cleanup when retention is 0 (indefinite)', async () => {
      const deletedCount = await serviceWithNoRetention.cleanupOldRecords();

      expect(mockPrismaNoRetention.auditLog.deleteMany).not.toHaveBeenCalled();
      expect(deletedCount).toBe(0);
    });

    it('should not start cleanup timer on init when retention is 0', async () => {
      mockPrismaNoRetention.auditLog.deleteMany.mockResolvedValue({ count: 0 });

      await serviceWithNoRetention.onModuleInit();

      expect(mockPrismaNoRetention.auditLog.deleteMany).not.toHaveBeenCalled();
    });
  });
});
