import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { MemoryHealthIndicator } from './indicators/memory.health';
import { HealthModuleOptions } from './health.module';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let memoryHealth: MemoryHealthIndicator;
  let databaseHealth: DatabaseHealthIndicator;

  const mockOptions: HealthModuleOptions = {
    serviceName: 'test-service',
    hasDatabase: true,
  };

  const mockMemoryResult = {
    memory: {
      status: 'up' as const,
      heapUsed: '50.00MB',
      heapTotal: '100.00MB',
      rss: '150.00MB',
      external: '10.00MB',
      heapThreshold: '150.00MB',
      rssThreshold: '300.00MB',
    },
  };

  const mockDatabaseResult = {
    database: {
      status: 'up' as const,
      responseTime: '5ms',
    },
  };

  beforeEach(async () => {
    const mockHealthCheckService = {
      check: jest.fn().mockImplementation(async (checks) => {
        const results = await Promise.all(
          checks.map((check: () => Promise<unknown>) => check()),
        );
        return {
          status: 'ok',
          info: Object.assign({}, ...results),
          error: {},
          details: Object.assign({}, ...results),
        } as HealthCheckResult;
      }),
    };

    const mockMemoryHealth = {
      check: jest.fn().mockResolvedValue(mockMemoryResult),
    };

    const mockDatabaseHealth = {
      check: jest.fn().mockResolvedValue(mockDatabaseResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: mockHealthCheckService,
        },
        {
          provide: MemoryHealthIndicator,
          useValue: mockMemoryHealth,
        },
        {
          provide: DatabaseHealthIndicator,
          useValue: mockDatabaseHealth,
        },
        {
          provide: 'HEALTH_OPTIONS',
          useValue: mockOptions,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    memoryHealth = module.get<MemoryHealthIndicator>(MemoryHealthIndicator);
    databaseHealth = module.get<DatabaseHealthIndicator>(
      DatabaseHealthIndicator,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should return full health check result with service metadata', async () => {
      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.info).toBeDefined();
      expect(result.info?.service).toBeDefined();
      expect(result.info?.service?.name).toBe('test-service');
      expect(result.info?.service?.status).toBe('up');
      expect(result.info?.service?.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include memory health check', async () => {
      await controller.check();

      expect(memoryHealth.check).toHaveBeenCalled();
    });

    it('should include database health check when available', async () => {
      await controller.check();

      expect(databaseHealth.check).toHaveBeenCalled();
    });

    it('should call health check service with all checks', async () => {
      await controller.check();

      expect(healthCheckService.check).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Function)]),
      );
    });
  });

  describe('liveness', () => {
    it('should return basic liveness status', async () => {
      const result = await controller.liveness();

      expect(result.status).toBe('ok');
      expect(result.info).toBeDefined();
    });

    it('should include service name in liveness response', async () => {
      const result = await controller.liveness();

      expect(result.info?.app?.name).toBe('test-service');
      expect(result.info?.app?.status).toBe('up');
    });

    it('should not call database health check', async () => {
      await controller.liveness();

      expect(databaseHealth.check).not.toHaveBeenCalled();
    });

    it('should not call memory health check', async () => {
      await controller.liveness();

      expect(memoryHealth.check).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('should return readiness status', async () => {
      const result = await controller.readiness();

      expect(result.status).toBe('ok');
    });

    it('should include database health check when available', async () => {
      await controller.readiness();

      expect(databaseHealth.check).toHaveBeenCalled();
    });
  });

  describe('without database', () => {
    let controllerWithoutDb: HealthController;

    beforeEach(async () => {
      const mockHealthCheckService = {
        check: jest.fn().mockImplementation(async (checks) => {
          const results = await Promise.all(
            checks.map((check: () => Promise<unknown>) => check()),
          );
          return {
            status: 'ok',
            info: Object.assign({}, ...results),
            error: {},
            details: Object.assign({}, ...results),
          } as HealthCheckResult;
        }),
      };

      const mockMemoryHealth = {
        check: jest.fn().mockResolvedValue(mockMemoryResult),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          {
            provide: HealthCheckService,
            useValue: mockHealthCheckService,
          },
          {
            provide: MemoryHealthIndicator,
            useValue: mockMemoryHealth,
          },
          {
            provide: 'HEALTH_OPTIONS',
            useValue: { serviceName: 'api-gateway' },
          },
        ],
      }).compile();

      controllerWithoutDb = module.get<HealthController>(HealthController);
    });

    it('should work without database health indicator', async () => {
      const result = await controllerWithoutDb.check();

      expect(result.status).toBe('ok');
      expect(result.info?.service?.name).toBe('api-gateway');
    });

    it('should return app status in readiness when no database', async () => {
      const result = await controllerWithoutDb.readiness();

      expect(result.status).toBe('ok');
      expect(result.info?.app?.name).toBe('api-gateway');
    });
  });
});
