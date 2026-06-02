import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { PersonalizedFeedService } from './personalized-feed.service';
import { ScoringService } from './scoring.service';
import {
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
} from './personalized-feed.service';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';

describe('PersonalizedFeedService', () => {
  let service: PersonalizedFeedService;
  let db: MockDbClient;

  const FLAGS_OFF: PersonalizationInputDto['flags'] = {
    isRenter: false,
    isHomeowner: false,
    isParent: false,
    isCaregiver: false,
    isStudent: false,
    isEducator: false,
    isWorker: false,
    isBusinessOwner: false,
    isUnionMember: false,
    isGigWorker: false,
    isTransitRider: false,
    isDriver: false,
    hasSpecialLicense: false,
    hasImmigrationConcern: false,
    hasHealthCondition: false,
    hasPublicHealthInsurance: false,
    isVeteran: false,
    hasJusticeInvolvement: false,
    isLowIncome: false,
    receivesPublicBenefits: false,
  };

  /** Build a Bill row with the JSONB aiSummary in the shape Prisma returns. */
  const mkBillRow = (
    id: string,
    aiSummary: Record<string, unknown> | null,
    lastActionDate: Date | null = null,
  ) =>
    ({
      id,
      lastActionDate,
      aiSummary,
    }) as never;

  beforeEach(async () => {
    db = createMockDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedFeedService,
        ScoringService,
        { provide: DbService, useValue: db },
      ],
    }).compile();
    service = module.get(PersonalizedFeedService);
  });

  it('returns empty when no enriched bills exist', async () => {
    db.bill.findMany.mockResolvedValue([] as never);
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      5,
    );
    expect(result).toEqual([]);
  });

  it('queries the bills table with aiSummary-not-null filter', async () => {
    db.bill.findMany.mockResolvedValue([] as never);
    await service.getFeedForUser(
      'u-1',
      { interestTags: [], flags: FLAGS_OFF },
      5,
    );
    const call = db.bill.findMany.mock.calls[0][0]!;
    // The where clause must filter to enriched bills only — bills
    // without aiSummary haven't been processed by #741 and can't be
    // scored by v1.0.
    expect(call.where).toMatchObject({
      aiSummary: { not: expect.anything() },
    });
  });

  it('hard-includes only currently-moveable bills regardless of caller flag (#747)', async () => {
    db.bill.findMany.mockResolvedValue([] as never);
    await service.getFeedForUser(
      'u-1',
      { interestTags: [], flags: FLAGS_OFF },
      5,
    );
    const call = db.bill.findMany.mock.calls[0][0]!;
    expect(call.where).toMatchObject({ isActive: true });
  });

  it('drops bills with null aiSummary even if returned by the query', async () => {
    db.bill.findMany.mockResolvedValue([mkBillRow('b-null', null)] as never);
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      5,
    );
    expect(result).toEqual([]);
  });

  it('drops bills with { skip: true } sentinel from the bill-analysis prompt', async () => {
    db.bill.findMany.mockResolvedValue([
      mkBillRow('b-skip', { skip: true }),
    ] as never);
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      5,
    );
    expect(result).toEqual([]);
  });

  it('drops bills with both empty topics and empty whoItAffects', async () => {
    db.bill.findMany.mockResolvedValue([
      mkBillRow('b-empty', { topics: [], whoItAffects: [] }),
    ] as never);
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      5,
    );
    expect(result).toEqual([]);
  });

  it('drops zero-relevance bills rather than padding the feed', async () => {
    db.bill.findMany.mockResolvedValue([
      mkBillRow('b-1', { topics: ['agriculture'], whoItAffects: ['farmers'] }),
    ] as never);
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      5,
    );
    // Bill doesn't match user's interests at all — drop rather than
    // showing as a 0.0-relevance result. Better to return fewer good
    // items than pad with noise.
    expect(result).toEqual([]);
  });

  it('returns scored + sorted top-K (basic happy path)', async () => {
    db.bill.findMany.mockResolvedValue([
      // Bill A: perfect topic match
      mkBillRow('b-perfect', {
        topics: ['housing'],
        whoItAffects: ['renters'],
      }),
      // Bill B: only stakeholder match (no topic)
      mkBillRow('b-stakeholder', {
        topics: ['agriculture'],
        whoItAffects: ['renters'],
      }),
      // Bill C: only topic match (no stakeholder)
      mkBillRow('b-topic', {
        topics: ['housing'],
        whoItAffects: ['farmers'],
      }),
    ] as never);

    const result = await service.getFeedForUser(
      'u-1',
      {
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      },
      5,
    );

    expect(result).toHaveLength(3);
    expect(result[0].billId).toBe('b-perfect');
    expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
    expect(result[1].relevanceScore).toBeGreaterThan(result[2].relevanceScore);
  });

  it('respects the requested limit', async () => {
    db.bill.findMany.mockResolvedValue([
      mkBillRow('b-1', { topics: ['housing'], whoItAffects: [] }),
      mkBillRow('b-2', { topics: ['housing'], whoItAffects: [] }),
      mkBillRow('b-3', { topics: ['housing'], whoItAffects: [] }),
    ] as never);

    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      2,
    );
    expect(result).toHaveLength(2);
  });

  it('caps at FEED_MAX_LIMIT regardless of caller value', async () => {
    const bills = Array.from({ length: 50 }, (_, i) =>
      mkBillRow(`b-${i}`, { topics: ['housing'], whoItAffects: [] }),
    );
    db.bill.findMany.mockResolvedValue(bills as never);

    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      // Caller asks for 1000 — should be clamped
      1000,
    );
    expect(result).toHaveLength(FEED_MAX_LIMIT);
  });

  it('uses the default limit when 0 is passed', async () => {
    const bills = Array.from({ length: 50 }, (_, i) =>
      mkBillRow(`b-${i}`, { topics: ['housing'], whoItAffects: [] }),
    );
    db.bill.findMany.mockResolvedValue(bills as never);

    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      0,
    );
    expect(result).toHaveLength(FEED_DEFAULT_LIMIT);
  });

  it('uses the default limit when a negative value is passed', async () => {
    // Defensive: callers passing -1, -5, NaN-ish values should default
    // rather than getting 1 result (or 0, or throwing). See op-review #5.
    const bills = Array.from({ length: 50 }, (_, i) =>
      mkBillRow(`b-${i}`, { topics: ['housing'], whoItAffects: [] }),
    );
    db.bill.findMany.mockResolvedValue(bills as never);

    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      -5,
    );
    expect(result).toHaveLength(FEED_DEFAULT_LIMIT);
  });

  it('filters non-string entries from topics/whoItAffects arrays (defensive)', async () => {
    db.bill.findMany.mockResolvedValue([
      mkBillRow('b-mixed', {
        topics: ['housing', 42, null, 'taxation'],
        whoItAffects: ['renters', { invalid: true }],
      }),
    ] as never);

    const result = await service.getFeedForUser(
      'u-1',
      {
        interestTags: ['housing', 'taxation'],
        flags: { ...FLAGS_OFF, isRenter: true },
      },
      5,
    );
    // Coercion drops the non-string entries; valid ones still score.
    expect(result).toHaveLength(1);
    expect(result[0].billId).toBe('b-mixed');
    expect(result[0].axisScores.valuesAlignment).toBeGreaterThan(0);
  });
});
