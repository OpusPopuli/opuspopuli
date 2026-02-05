import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthIndicator } from './database.health';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbClient,
  MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;
  let db: MockDbClient;

  beforeEach(async () => {
    db = createMockDbClient();
    db.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthIndicator,
        {
          provide: DbService,
          useValue: db,
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

      expect(db.$queryRaw).toHaveBeenCalled();
    });

    it('should include response time in result', async () => {
      const result = await indicator.check();

      expect(result.database.responseTime).toMatch(/^\d+ms$/);
    });

    it('should return down status when database query fails', async () => {
      db.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const result = await indicator.check();

      expect(result.database.status).toBe('down');
      expect(result.database.error).toBe('Connection refused');
      expect(result.database.responseTime).toBeDefined();
    });

    it('should handle unknown errors', async () => {
      db.$queryRaw.mockRejectedValue('Unknown error');

      const result = await indicator.check();

      expect(result.database.status).toBe('down');
      expect(result.database.error).toBe('Unknown error');
    });

    it('should measure response time even on failure', async () => {
      db.$queryRaw.mockRejectedValue(new Error('Timeout'));

      const result = await indicator.check();

      expect(result.database.responseTime).toMatch(/^\d+ms$/);
    });
  });
});
