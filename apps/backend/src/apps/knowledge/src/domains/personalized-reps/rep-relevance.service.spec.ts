import { Test, TestingModule } from '@nestjs/testing';
import {
  RepRelevanceService,
  type RankableRep,
  type RepRankingContext,
} from './rep-relevance.service';
import type { RepPersonalizationInputDto } from './dto/rep-personalization-input.dto';

const FLAGS_OFF: RepPersonalizationInputDto['flags'] = {
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

const baseRep = (overrides: Partial<RankableRep> = {}): RankableRep => ({
  id: 'r-1',
  chamber: 'Assembly',
  committeeNames: [],
  recentActions: [],
  ...overrides,
});

const emptyCtx = (
  overrides: Partial<RepRankingContext> = {},
): RepRankingContext => ({
  userBillIdsOfInterest: new Set(),
  userBillsByChamber: {},
  ...overrides,
});

describe('RepRelevanceService', () => {
  let service: RepRelevanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RepRelevanceService],
    }).compile();
    service = module.get(RepRelevanceService);
  });

  describe('scoreChamberMatch (axis 1)', () => {
    it('returns 0 when the user has no bills-of-interest', () => {
      expect(
        service.scoreChamberMatch(
          baseRep(),
          emptyCtx({ userBillsByChamber: {} }),
        ),
      ).toBe(0);
    });

    it('returns the fraction of user bills in the rep chamber', () => {
      // 6 Senate bills + 4 Assembly bills = 10 total. An Assembly rep gets 0.4.
      expect(
        service.scoreChamberMatch(
          baseRep({ chamber: 'Assembly' }),
          emptyCtx({ userBillsByChamber: { Senate: 6, Assembly: 4 } }),
        ),
      ).toBeCloseTo(0.4, 5);
    });

    it('returns 1.0 when every user bill is in the rep chamber', () => {
      expect(
        service.scoreChamberMatch(
          baseRep({ chamber: 'Senate' }),
          emptyCtx({ userBillsByChamber: { Senate: 8 } }),
        ),
      ).toBe(1.0);
    });

    it('returns 0 when no user bills live in the rep chamber', () => {
      expect(
        service.scoreChamberMatch(
          baseRep({ chamber: 'Assembly' }),
          emptyCtx({ userBillsByChamber: { Senate: 5 } }),
        ),
      ).toBe(0);
    });
  });

  describe('scoreCommitteeMatch (axis 2)', () => {
    it('returns 0 when the rep has no committees', () => {
      expect(
        service.scoreCommitteeMatch(baseRep({ committeeNames: [] }), [
          'housing',
        ]),
      ).toBe(0);
    });

    it('returns 0 when the user has no interest tags', () => {
      expect(
        service.scoreCommitteeMatch(
          baseRep({ committeeNames: ['Housing and Community Development'] }),
          [],
        ),
      ).toBe(0);
    });

    it('returns fraction of rep committees that match any tag', () => {
      // 3 committees, 1 matches "housing" → 1/3
      expect(
        service.scoreCommitteeMatch(
          baseRep({
            committeeNames: [
              'Housing and Community Development',
              'Transportation',
              'Veterans Affairs',
            ],
          }),
          ['housing'],
        ),
      ).toBeCloseTo(1 / 3, 5);
    });

    it('returns 1.0 when every rep committee matches a tag', () => {
      expect(
        service.scoreCommitteeMatch(
          baseRep({
            committeeNames: ['Housing and Community Development', 'Housing'],
          }),
          ['housing'],
        ),
      ).toBe(1.0);
    });

    it('matches case-insensitively at word boundaries', () => {
      // "education" should match "Education" but NOT "deducation" or "educational" (\\b boundary)
      expect(
        service.scoreCommitteeMatch(
          baseRep({ committeeNames: ['Education', 'Reducation'] }),
          ['education'],
        ),
      ).toBe(0.5);
    });

    it('matches across multiple tags (counts each committee once)', () => {
      // "transportation" and "housing" each match a distinct committee → 2/2
      expect(
        service.scoreCommitteeMatch(
          baseRep({
            committeeNames: ['Transportation', 'Housing'],
          }),
          ['transportation', 'housing'],
        ),
      ).toBe(1.0);
    });
  });

  describe('scoreActionAlignment (axis 3)', () => {
    it('returns 0 when the user has no bills-of-interest', () => {
      expect(
        service.scoreActionAlignment(
          baseRep({
            recentActions: [{ billId: 'b1', role: 'author' }],
          }),
          emptyCtx(),
        ),
      ).toBe(0);
    });

    it('returns 0 when the rep has no recent actions on user bills', () => {
      expect(
        service.scoreActionAlignment(
          baseRep({
            recentActions: [{ billId: 'b9', role: 'author' }],
          }),
          emptyCtx({ userBillIdsOfInterest: new Set(['b1']) }),
        ),
      ).toBe(0);
    });

    it('weights author > coauthor > voteYes > voteNo', () => {
      const ctx = emptyCtx({
        userBillIdsOfInterest: new Set(['b1', 'b2', 'b3', 'b4']),
      });
      // total = 1.0 + 0.6 + 0.4 + 0.2 = 2.2; saturation = 3; → 2.2/3
      expect(
        service.scoreActionAlignment(
          baseRep({
            recentActions: [
              { billId: 'b1', role: 'author' },
              { billId: 'b2', role: 'coauthor' },
              { billId: 'b3', role: 'voteYes' },
              { billId: 'b4', role: 'voteNo' },
            ],
          }),
          ctx,
        ),
      ).toBeCloseTo(2.2 / 3, 5);
    });

    it('saturates at 1.0 when matches exceed the saturation point', () => {
      // 4 author-grade matches = 4.0 unweighted → capped at 1.0
      expect(
        service.scoreActionAlignment(
          baseRep({
            recentActions: [
              { billId: 'b1', role: 'author' },
              { billId: 'b2', role: 'author' },
              { billId: 'b3', role: 'author' },
              { billId: 'b4', role: 'author' },
            ],
          }),
          emptyCtx({
            userBillIdsOfInterest: new Set(['b1', 'b2', 'b3', 'b4']),
          }),
        ),
      ).toBe(1.0);
    });

    it('dedupes best-role-per-bill (author + voteYes on same bill = 1.0, not 1.4)', () => {
      // total weight for b1 = max(1.0, 0.4) = 1.0; /3 = 0.333
      expect(
        service.scoreActionAlignment(
          baseRep({
            recentActions: [
              { billId: 'b1', role: 'author' },
              { billId: 'b1', role: 'voteYes' },
            ],
          }),
          emptyCtx({ userBillIdsOfInterest: new Set(['b1']) }),
        ),
      ).toBeCloseTo(1 / 3, 5);
    });

    it('takes the best role even when actions arrive in arbitrary order', () => {
      // voteNo (0.2) arrives before author (1.0) — score should still use 1.0
      expect(
        service.scoreActionAlignment(
          baseRep({
            recentActions: [
              { billId: 'b1', role: 'voteNo' },
              { billId: 'b1', role: 'author' },
            ],
          }),
          emptyCtx({ userBillIdsOfInterest: new Set(['b1']) }),
        ),
      ).toBeCloseTo(1 / 3, 5);
    });
  });

  describe('pickRecentActivityBillIds', () => {
    it('returns at most 3 bill ids sorted by role weight desc', () => {
      const ctx = emptyCtx({
        userBillIdsOfInterest: new Set(['b1', 'b2', 'b3', 'b4']),
      });
      // b3=author(1.0), b1=coauthor(0.6), b2=voteYes(0.4), b4=voteNo(0.2)
      // → top 3: b3, b1, b2 (b4 trimmed)
      expect(
        service.pickRecentActivityBillIds(
          baseRep({
            recentActions: [
              { billId: 'b1', role: 'coauthor' },
              { billId: 'b2', role: 'voteYes' },
              { billId: 'b3', role: 'author' },
              { billId: 'b4', role: 'voteNo' },
            ],
          }),
          ctx,
        ),
      ).toEqual(['b3', 'b1', 'b2']);
    });

    it('deterministically breaks ties by billId asc', () => {
      // Three author-grade matches all weight 1.0 — order by id
      const ctx = emptyCtx({
        userBillIdsOfInterest: new Set(['bZ', 'bA', 'bM']),
      });
      expect(
        service.pickRecentActivityBillIds(
          baseRep({
            recentActions: [
              { billId: 'bZ', role: 'author' },
              { billId: 'bA', role: 'author' },
              { billId: 'bM', role: 'author' },
            ],
          }),
          ctx,
        ),
      ).toEqual(['bA', 'bM', 'bZ']);
    });

    it('skips bills outside the user bills-of-interest set', () => {
      expect(
        service.pickRecentActivityBillIds(
          baseRep({
            recentActions: [
              { billId: 'b1', role: 'author' },
              { billId: 'b99', role: 'author' },
            ],
          }),
          emptyCtx({ userBillIdsOfInterest: new Set(['b1']) }),
        ),
      ).toEqual(['b1']);
    });

    it('returns an empty array when nothing matches', () => {
      expect(
        service.pickRecentActivityBillIds(
          baseRep({ recentActions: [] }),
          emptyCtx({ userBillIdsOfInterest: new Set(['b1']) }),
        ),
      ).toEqual([]);
    });
  });

  describe('scoreRep (composite)', () => {
    it('zeroes axes 4-7 (v1.1 placeholders)', () => {
      const { axisScores } = service.scoreRep(
        baseRep(),
        { representativeIds: [], interestTags: [], flags: FLAGS_OFF },
        emptyCtx(),
      );
      expect(axisScores.constituencyOverlap).toBe(0);
      expect(axisScores.coalitionSignal).toBe(0);
      expect(axisScores.counterfactual).toBe(0);
      expect(axisScores.noveltyRepetition).toBe(0);
    });

    it('weights axes 0.2 / 0.3 / 0.5 (chamber / committee / action)', () => {
      // chamberMatch=1.0, committeeMatch=1.0, actionAlignment=1.0
      // composite = 0.2 + 0.3 + 0.5 = 1.0
      const rep = baseRep({
        chamber: 'Assembly',
        committeeNames: ['Housing'],
        recentActions: [
          { billId: 'b1', role: 'author' },
          { billId: 'b2', role: 'author' },
          { billId: 'b3', role: 'author' },
        ],
      });
      const ctx = emptyCtx({
        userBillIdsOfInterest: new Set(['b1', 'b2', 'b3']),
        userBillsByChamber: { Assembly: 3 },
      });
      const { composite } = service.scoreRep(
        rep,
        { representativeIds: [], interestTags: ['housing'], flags: FLAGS_OFF },
        ctx,
      );
      expect(composite).toBeCloseTo(1.0, 5);
    });

    it('returns 0 composite when nothing aligns', () => {
      // Rep in Senate but all user bills in Assembly + no committee + no actions
      const { composite } = service.scoreRep(
        baseRep({ chamber: 'Senate' }),
        { representativeIds: [], interestTags: ['housing'], flags: FLAGS_OFF },
        emptyCtx({
          userBillIdsOfInterest: new Set(['b1']),
          userBillsByChamber: { Assembly: 1 },
        }),
      );
      expect(composite).toBe(0);
    });

    it('produces a partial composite when one axis fires', () => {
      // Only chamberMatch fires (committee + action zero) → 1.0 * 0.2 = 0.2
      const { composite } = service.scoreRep(
        baseRep({ chamber: 'Senate' }),
        { representativeIds: [], interestTags: ['housing'], flags: FLAGS_OFF },
        emptyCtx({
          userBillIdsOfInterest: new Set(['b1']),
          userBillsByChamber: { Senate: 1 },
        }),
      );
      expect(composite).toBeCloseTo(0.2, 5);
    });
  });
});
