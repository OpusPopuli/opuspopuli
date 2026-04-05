import { Test, TestingModule } from '@nestjs/testing';
import { MemoryHealthIndicator } from './memory.health';
import { HealthModuleOptions } from '../health.module';

// Helper to create a mock memoryUsage function with proper typing
const createMockMemoryUsage = (values: NodeJS.MemoryUsage) => {
  const mockFn = jest.fn().mockReturnValue(values) as jest.Mock & {
    rss: () => number;
  };
  mockFn.rss = jest.fn().mockReturnValue(values.rss);
  return mockFn as typeof process.memoryUsage;
};

describe('MemoryHealthIndicator', () => {
  let indicator: MemoryHealthIndicator;
  let originalMemoryUsage: typeof process.memoryUsage;

  const defaultOptions: HealthModuleOptions = {
    serviceName: 'test-service',
  };

  beforeAll(() => {
    originalMemoryUsage = process.memoryUsage;
  });

  afterAll(() => {
    process.memoryUsage = originalMemoryUsage;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryHealthIndicator,
        {
          provide: 'HEALTH_OPTIONS',
          useValue: defaultOptions,
        },
      ],
    }).compile();

    indicator = module.get<MemoryHealthIndicator>(MemoryHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.memoryUsage = originalMemoryUsage;
  });

  describe('check', () => {
    it('should return up status when memory is within thresholds', async () => {
      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 50 * 1024 * 1024, // 50MB
        heapTotal: 100 * 1024 * 1024, // 100MB
        rss: 150 * 1024 * 1024, // 150MB
        external: 10 * 1024 * 1024, // 10MB
        arrayBuffers: 5 * 1024 * 1024, // 5MB
      });

      const result = await indicator.check();

      expect(result.memory).toBeDefined();
      expect(result.memory.status).toBe('up');
    });

    it('should include memory usage details', async () => {
      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      const result = await indicator.check();

      expect(result.memory.heapUsed).toBe('50.00MB');
      expect(result.memory.heapTotal).toBe('100.00MB');
      expect(result.memory.rss).toBe('150.00MB');
      expect(result.memory.external).toBe('10.00MB');
    });

    it('should include threshold values in result', async () => {
      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      const result = await indicator.check();

      expect(result.memory.heapThreshold).toBe('512.00MB');
      expect(result.memory.rssThreshold).toBe('1024.00MB');
    });

    it('should return down status when heap exceeds threshold', async () => {
      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 600 * 1024 * 1024, // 600MB > 512MB threshold
        heapTotal: 700 * 1024 * 1024,
        rss: 500 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      const result = await indicator.check();

      expect(result.memory.status).toBe('down');
    });

    it('should return down status when RSS exceeds threshold', async () => {
      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 150 * 1024 * 1024,
        rss: 1200 * 1024 * 1024, // 1200MB > 1024MB threshold
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      const result = await indicator.check();

      expect(result.memory.status).toBe('down');
    });
  });

  describe('custom thresholds', () => {
    it('should use custom heap threshold', async () => {
      const customOptions: HealthModuleOptions = {
        serviceName: 'test-service',
        memoryHeapThreshold: 100 * 1024 * 1024, // 100MB
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MemoryHealthIndicator,
          {
            provide: 'HEALTH_OPTIONS',
            useValue: customOptions,
          },
        ],
      }).compile();

      const customIndicator = module.get<MemoryHealthIndicator>(
        MemoryHealthIndicator,
      );

      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 120 * 1024 * 1024, // 120MB > 100MB custom threshold
        heapTotal: 150 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      const result = await customIndicator.check();

      expect(result.memory.status).toBe('down');
      expect(result.memory.heapThreshold).toBe('100.00MB');
    });

    it('should use custom RSS threshold', async () => {
      const customOptions: HealthModuleOptions = {
        serviceName: 'test-service',
        memoryRssThreshold: 200 * 1024 * 1024, // 200MB
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MemoryHealthIndicator,
          {
            provide: 'HEALTH_OPTIONS',
            useValue: customOptions,
          },
        ],
      }).compile();

      const customIndicator = module.get<MemoryHealthIndicator>(
        MemoryHealthIndicator,
      );

      process.memoryUsage = createMockMemoryUsage({
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        rss: 250 * 1024 * 1024, // 250MB > 200MB custom threshold
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });

      const result = await customIndicator.check();

      expect(result.memory.status).toBe('down');
      expect(result.memory.rssThreshold).toBe('200.00MB');
    });
  });
});
