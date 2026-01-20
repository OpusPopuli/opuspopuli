import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthIndicator } from './database.health';
import { PrismaService } from 'src/db/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from 'src/test/prisma-mock';

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthIndicator,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    indicator = module.get<DatabaseHealthIndicator>(DatabaseHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should return up status when database is reachable', async () => {
      const result = await indicator.check();

      expect(result.database).toBeDefined();
      expect(result.database.status).toBe('up');
      expect(result.database.responseTime).toBeDefined();
    });

    it('should execute SELECT 1 query', async () => {
      await indicator.check();

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('should include response time in result', async () => {
      const result = await indicator.check();

      expect(result.database.responseTime).toMatch(/^\d+ms$/);
    });

    it('should return down status when database query fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const result = await indicator.check();

      expect(result.database.status).toBe('down');
      expect(result.database.error).toBe('Connection refused');
      expect(result.database.responseTime).toBeDefined();
    });

    it('should handle unknown errors', async () => {
      prisma.$queryRaw.mockRejectedValue('Unknown error');

      const result = await indicator.check();

      expect(result.database.status).toBe('down');
      expect(result.database.error).toBe('Unknown error');
    });

    it('should measure response time even on failure', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Timeout'));

      const result = await indicator.check();

      expect(result.database.responseTime).toMatch(/^\d+ms$/);
    });
  });
});
