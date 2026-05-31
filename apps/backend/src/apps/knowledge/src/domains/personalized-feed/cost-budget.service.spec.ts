import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { CostBudgetService } from './cost-budget.service';

async function makeService(opts: {
  envCap?: string;
  cacheRows?: { tokensIn: number | null; tokensOut: number | null }[];
}): Promise<{ service: CostBudgetService; db: MockDbClient }> {
  const db = createMockDbService();
  (db.personalizedFeedCache.findMany as jest.Mock).mockResolvedValue(
    opts.cacheRows ?? [],
  );
  const config = {
    get: jest.fn().mockReturnValue(opts.envCap),
  } as unknown as ConfigService;

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CostBudgetService,
      { provide: DbService, useValue: db },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return { service: module.get(CostBudgetService), db };
}

describe('CostBudgetService', () => {
  it('defaults the cap to 10,000 tokens when env var is unset', async () => {
    const { service } = await makeService({});
    expect(service.dailyCap).toBe(10_000);
  });

  it('reads the cap from LLM_RERANK_PER_USER_DAILY_TOKEN_CAP', async () => {
    const { service } = await makeService({ envCap: '2500' });
    expect(service.dailyCap).toBe(2500);
  });

  it('falls back to default when env value is non-numeric', async () => {
    const { service } = await makeService({ envCap: 'abc' });
    expect(service.dailyCap).toBe(10_000);
  });

  it('returns true when the day total is below the cap', async () => {
    const { service } = await makeService({
      envCap: '1000',
      cacheRows: [
        { tokensIn: 100, tokensOut: 200 },
        { tokensIn: 50, tokensOut: 150 },
      ],
    });
    expect(await service.withinBudget('u-1')).toBe(true);
  });

  it('returns false when the day total is at or above the cap', async () => {
    const { service } = await makeService({
      envCap: '500',
      cacheRows: [
        { tokensIn: 200, tokensOut: 200 },
        { tokensIn: null, tokensOut: 150 },
      ],
    });
    expect(await service.withinBudget('u-1')).toBe(false);
  });

  it('handles null token columns without crashing', async () => {
    const { service } = await makeService({
      cacheRows: [{ tokensIn: null, tokensOut: null }],
    });
    expect(await service.withinBudget('u-1')).toBe(true);
  });

  it('returns true (fail-open) when the DB lookup throws', async () => {
    const { service, db } = await makeService({});
    (db.personalizedFeedCache.findMany as jest.Mock).mockRejectedValue(
      new Error('DB down'),
    );
    expect(await service.withinBudget('u-1')).toBe(true);
  });
});
