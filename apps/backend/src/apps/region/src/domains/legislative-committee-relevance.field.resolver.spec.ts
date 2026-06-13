import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  CommitteeRelevanceCacheLookup,
  LegislativeCommitteeDetailRelevanceFieldResolver,
  LegislativeCommitteeRelevanceFieldResolver,
} from './legislative-committee-relevance.field.resolver';

/**
 * Unit tests for the committee `relevanceExplanation` field resolvers
 * (opuspopuli#836). Verifies the cache-hit / cache-miss behavior and
 * locks in the (userId, legislativeCommitteeId) lookup key — a mistake
 * here would either leak another user's explanation OR fail to match
 * the writer's upsert key from `CommitteeRelevanceCache` in the schema.
 *
 * Both resolver classes share the same `CommitteeRelevanceCacheLookup`
 * helper; we test it directly plus one assertion per derived resolver
 * to confirm the delegation works.
 */

function makeContext(userId: string) {
  return {
    req: { user: { id: userId } },
  } as unknown as Parameters<
    LegislativeCommitteeRelevanceFieldResolver['resolveRelevanceExplanation']
  >[1];
}

describe('LegislativeCommittee relevance field resolvers (#836)', () => {
  let db: {
    committeeRelevanceCache: { findUnique: jest.Mock };
  };
  let lookup: CommitteeRelevanceCacheLookup;
  let compactResolver: LegislativeCommitteeRelevanceFieldResolver;
  let detailResolver: LegislativeCommitteeDetailRelevanceFieldResolver;

  beforeEach(async () => {
    db = {
      committeeRelevanceCache: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommitteeRelevanceCacheLookup,
        LegislativeCommitteeRelevanceFieldResolver,
        LegislativeCommitteeDetailRelevanceFieldResolver,
        { provide: DbService, useValue: db },
      ],
    }).compile();
    lookup = module.get(CommitteeRelevanceCacheLookup);
    compactResolver = module.get(LegislativeCommitteeRelevanceFieldResolver);
    detailResolver = module.get(
      LegislativeCommitteeDetailRelevanceFieldResolver,
    );
  });

  describe('CommitteeRelevanceCacheLookup', () => {
    it('returns the cached explanation on cache hit', async () => {
      db.committeeRelevanceCache.findUnique.mockResolvedValue({
        relevanceExplanation: 'Your rep Lofgren sits on it.',
      });
      const result = await lookup.lookup('u-1', 'c-1');
      expect(result).toBe('Your rep Lofgren sits on it.');
    });

    it('returns null on cache miss (no row for this user/committee)', async () => {
      db.committeeRelevanceCache.findUnique.mockResolvedValue(null);
      expect(await lookup.lookup('u-1', 'c-missing')).toBeNull();
    });

    it('returns null when the cached row has a null explanation (LLM declined / validator rejected)', async () => {
      db.committeeRelevanceCache.findUnique.mockResolvedValue({
        relevanceExplanation: null,
      });
      expect(await lookup.lookup('u-1', 'c-1')).toBeNull();
    });

    it('queries by the (userId, legislativeCommitteeId) compound key', async () => {
      db.committeeRelevanceCache.findUnique.mockResolvedValue(null);
      await lookup.lookup('u-1', 'c-1');
      expect(db.committeeRelevanceCache.findUnique).toHaveBeenCalledWith({
        where: {
          userId_legislativeCommitteeId: {
            userId: 'u-1',
            legislativeCommitteeId: 'c-1',
          },
        },
        select: { relevanceExplanation: true },
      });
    });
  });

  describe('LegislativeCommitteeRelevanceFieldResolver (compact model)', () => {
    it('resolves relevanceExplanation via the shared lookup, scoped to the current user', async () => {
      db.committeeRelevanceCache.findUnique.mockResolvedValue({
        relevanceExplanation: 'For u-1.',
      });
      const result = await compactResolver.resolveRelevanceExplanation(
        {
          id: 'c-1',
          externalId: 'assembly:judiciary',
          name: 'Judiciary',
          chamber: 'Assembly',
          memberCount: 7,
        },
        makeContext('u-1'),
      );
      expect(result).toBe('For u-1.');
      expect(db.committeeRelevanceCache.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_legislativeCommitteeId: {
              userId: 'u-1',
              legislativeCommitteeId: 'c-1',
            },
          },
        }),
      );
    });
  });

  describe('LegislativeCommitteeDetailRelevanceFieldResolver (detail model)', () => {
    it('resolves relevanceExplanation through the same shared lookup', async () => {
      db.committeeRelevanceCache.findUnique.mockResolvedValue({
        relevanceExplanation: 'For u-2.',
      });
      const result = await detailResolver.resolveRelevanceExplanation(
        {
          id: 'c-1',
          externalId: 'assembly:judiciary',
          name: 'Judiciary',
          chamber: 'Assembly',
          memberCount: 7,
          members: [],
          hearings: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        makeContext('u-2'),
      );
      expect(result).toBe('For u-2.');
      // Different user → different lookup key. Locks in no cross-user
      // leak path — a typo in either resolver that hardcodes a userId
      // would fail this assertion.
      expect(db.committeeRelevanceCache.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_legislativeCommitteeId: {
              userId: 'u-2',
              legislativeCommitteeId: 'c-1',
            },
          },
        }),
      );
    });
  });
});
