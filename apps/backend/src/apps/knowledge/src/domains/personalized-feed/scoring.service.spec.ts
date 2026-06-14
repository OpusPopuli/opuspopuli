import { Test, TestingModule } from '@nestjs/testing';
import { ScoringService, type RankableBill } from './scoring.service';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';

/**
 * Pure scoring function tests. Each axis has its own block; composite
 * tests verify the weighted-sum math.
 */
describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScoringService],
    }).compile();
    service = module.get(ScoringService);
  });

  // Helpers
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

  const mkBill = (overrides: Partial<RankableBill> = {}): RankableBill => ({
    id: 'b-1',
    lastActionDate: null,
    sourceUrl: null,
    aiSummary: { topics: [], whoItAffects: [] },
    ...overrides,
  });

  describe('scoreDirectMaterial (axis 1)', () => {
    it('returns 0 when bill has no aiSummary', () => {
      const bill = mkBill({ aiSummary: null });
      expect(service.scoreDirectMaterial(bill, FLAGS_OFF).score).toBe(0);
    });

    it('returns 0 when no stakeholder match', () => {
      const bill = mkBill({
        aiSummary: { topics: [], whoItAffects: ['renters', 'parents'] },
      });
      // User is neither a renter nor a parent
      expect(service.scoreDirectMaterial(bill, FLAGS_OFF).score).toBe(0);
    });

    it('scores 0.2 per stakeholder match', () => {
      const bill = mkBill({
        aiSummary: { topics: [], whoItAffects: ['renters'] },
      });
      const flags = { ...FLAGS_OFF, isRenter: true };
      expect(service.scoreDirectMaterial(bill, flags).score).toBe(0.2);
    });

    it('caps at 1.0 with 5+ matches', () => {
      const bill = mkBill({
        aiSummary: {
          topics: [],
          whoItAffects: [
            'renters',
            'parents',
            'workers',
            'veterans',
            'drivers',
            'patients',
          ], // 6 matches
        },
      });
      const flags = {
        ...FLAGS_OFF,
        isRenter: true,
        isParent: true,
        isWorker: true,
        isVeteran: true,
        isDriver: true,
        hasHealthCondition: true,
      };
      expect(service.scoreDirectMaterial(bill, flags).score).toBe(1.0);
    });

    it('ignores stakeholders with no flag mapping (e.g. "seniors")', () => {
      // "seniors" doesn't map to any v1.0 flag — should not contribute.
      const bill = mkBill({
        aiSummary: { topics: [], whoItAffects: ['seniors'] },
      });
      expect(service.scoreDirectMaterial(bill, FLAGS_OFF).score).toBe(0);
    });

    it('handles "immigrants" via hasImmigrationConcern flag', () => {
      const bill = mkBill({
        aiSummary: { topics: [], whoItAffects: ['immigrants'] },
      });
      const flags = { ...FLAGS_OFF, hasImmigrationConcern: true };
      expect(service.scoreDirectMaterial(bill, flags).score).toBe(0.2);
    });
  });

  describe('scoreValuesAlignment (axis 2)', () => {
    it('returns 0 when bill has no aiSummary', () => {
      const bill = mkBill({ aiSummary: null });
      expect(service.scoreValuesAlignment(bill, ['housing']).score).toBe(0);
    });

    it('returns 0 when user has no interestTags', () => {
      const bill = mkBill({
        aiSummary: { topics: ['housing'], whoItAffects: [] },
      });
      expect(service.scoreValuesAlignment(bill, []).score).toBe(0);
    });

    it('returns 1.0 when single interest matches single topic', () => {
      const bill = mkBill({
        aiSummary: { topics: ['housing'], whoItAffects: [] },
      });
      expect(service.scoreValuesAlignment(bill, ['housing']).score).toBe(1.0);
    });

    it('normalizes by user interest count, not bill topic count', () => {
      const bill = mkBill({
        aiSummary: {
          topics: ['housing', 'transportation'],
          whoItAffects: [],
        },
      });
      // User has 3 interests, bill matches 1 → 0.33
      expect(
        service.scoreValuesAlignment(bill, [
          'housing',
          'healthcare',
          'education',
        ]).score,
      ).toBeCloseTo(0.33, 2);
    });

    it('returns 0 when no overlap', () => {
      const bill = mkBill({
        aiSummary: { topics: ['housing'], whoItAffects: [] },
      });
      expect(service.scoreValuesAlignment(bill, ['healthcare']).score).toBe(0);
    });
  });

  describe('scoreActionability (axis 3)', () => {
    const NOW = new Date('2026-06-15T00:00:00Z');

    it('returns 0 when bill has no lastActionDate', () => {
      const bill = mkBill({ lastActionDate: null });
      expect(service.scoreActionability(bill, NOW).score).toBe(0);
    });

    it('returns 1.0 for bills with action within last 30 days', () => {
      const bill = mkBill({
        lastActionDate: new Date('2026-06-01T00:00:00Z'),
      });
      expect(service.scoreActionability(bill, NOW).score).toBe(1.0);
    });

    it('returns 0.5 for bills with action 30-60 days old', () => {
      const bill = mkBill({
        lastActionDate: new Date('2026-05-01T00:00:00Z'),
      });
      expect(service.scoreActionability(bill, NOW).score).toBe(0.5);
    });

    it('returns 0 for bills older than 60 days', () => {
      const bill = mkBill({
        lastActionDate: new Date('2026-03-01T00:00:00Z'),
      });
      expect(service.scoreActionability(bill, NOW).score).toBe(0);
    });

    it('treats future-dated bills as urgent (1.0)', () => {
      // Future dates can happen for scheduled votes; treat as urgent
      // rather than dropping the bill from the feed entirely.
      const bill = mkBill({
        lastActionDate: new Date('2026-07-01T00:00:00Z'),
      });
      expect(service.scoreActionability(bill, NOW).score).toBe(1.0);
    });
  });

  describe('scoreBill (composite)', () => {
    const NOW = new Date('2026-06-15T00:00:00Z');

    it('returns 0 composite for completely irrelevant bill', () => {
      const bill = mkBill({
        aiSummary: { topics: ['agriculture'], whoItAffects: ['farmers'] },
      });
      const input: PersonalizationInputDto = {
        interestTags: ['housing'],
        flags: FLAGS_OFF,
      };
      const result = service.scoreBill(bill, input, NOW);
      expect(result.composite).toBe(0);
      expect(result.axisScores.directMaterial).toBe(0);
      expect(result.axisScores.valuesAlignment).toBe(0);
    });

    it('applies the documented weights (0.5/0.3/0.2)', () => {
      // Perfect score on all three axes → composite = 1.0
      const bill = mkBill({
        lastActionDate: new Date('2026-06-01T00:00:00Z'),
        aiSummary: {
          topics: ['housing'],
          whoItAffects: ['renters'],
        },
      });
      const input: PersonalizationInputDto = {
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      };
      const result = service.scoreBill(bill, input, NOW);
      // axis 1: 0.2 (one match, capped at 0.2 each)
      // axis 2: 1.0 (1/1)
      // axis 3: 1.0
      // composite = 0.2*0.5 + 1.0*0.3 + 1.0*0.2 = 0.1 + 0.3 + 0.2 = 0.6
      expect(result.composite).toBeCloseTo(0.6, 4);
      expect(result.axisScores.directMaterial).toBe(0.2);
      expect(result.axisScores.valuesAlignment).toBe(1.0);
      expect(result.axisScores.actionability).toBe(1.0);
    });

    it('emits placeholder zeros for axes 4-7 (v1.1)', () => {
      const bill = mkBill({
        aiSummary: { topics: ['housing'], whoItAffects: [] },
      });
      const input: PersonalizationInputDto = {
        interestTags: ['housing'],
        flags: FLAGS_OFF,
      };
      const result = service.scoreBill(bill, input, NOW);
      expect(result.axisScores.indirectMaterial).toBe(0);
      expect(result.axisScores.coalitionSignal).toBe(0);
      expect(result.axisScores.counterfactual).toBe(0);
      expect(result.axisScores.noveltyRepetition).toBe(0);
    });

    it('a high-direct-match bill outranks a high-values-match bill (weight differential)', () => {
      // Bill A: 5 stakeholder matches, 0 topic match → axis1=1.0, axis2=0
      // Bill B: 0 stakeholder match, 1 topic match → axis1=0, axis2=1.0
      // Composite A: 1.0*0.5 = 0.5
      // Composite B: 1.0*0.3 = 0.3
      // Bill A should win.
      const billA = mkBill({
        aiSummary: {
          topics: [],
          whoItAffects: [
            'renters',
            'parents',
            'workers',
            'drivers',
            'patients',
          ],
        },
      });
      const billB = mkBill({
        aiSummary: { topics: ['housing'], whoItAffects: [] },
      });
      const input: PersonalizationInputDto = {
        interestTags: ['housing'],
        flags: {
          ...FLAGS_OFF,
          isRenter: true,
          isParent: true,
          isWorker: true,
          isDriver: true,
          hasHealthCondition: true,
        },
      };
      const a = service.scoreBill(billA, input, NOW);
      const b = service.scoreBill(billB, input, NOW);
      expect(a.composite).toBeGreaterThan(b.composite);
    });
  });

  describe('contributingSignals (#750)', () => {
    const NOW = new Date('2026-06-15T00:00:00Z');

    it('emits one FLAG signal per matched stakeholder', () => {
      const bill = mkBill({
        aiSummary: { topics: [], whoItAffects: ['renters', 'parents'] },
      });
      const flags = { ...FLAGS_OFF, isRenter: true, isParent: true };
      const { signals } = service.scoreDirectMaterial(bill, flags);
      expect(signals).toEqual([
        {
          type: 'flag',
          key: 'isRenter',
          axis: 'directMaterial',
          isSensitive: false,
        },
        {
          type: 'flag',
          key: 'isParent',
          axis: 'directMaterial',
          isSensitive: false,
        },
      ]);
    });

    it('marks T3-derived FLAG signals as isSensitive', () => {
      // veterans + immigrants + patients all route to T3-derived flags.
      const bill = mkBill({
        aiSummary: {
          topics: [],
          whoItAffects: ['veterans', 'immigrants', 'patients'],
        },
      });
      const flags = {
        ...FLAGS_OFF,
        isVeteran: true,
        hasImmigrationConcern: true,
        hasHealthCondition: true,
      };
      const { signals } = service.scoreDirectMaterial(bill, flags);
      expect(signals.every((s) => s.isSensitive)).toBe(true);
      expect(signals.map((s) => s.key)).toEqual([
        'isVeteran',
        'hasImmigrationConcern',
        'hasHealthCondition',
      ]);
    });

    it('emits no signal for a stakeholder the user does not match', () => {
      const bill = mkBill({
        aiSummary: { topics: [], whoItAffects: ['renters', 'parents'] },
      });
      // User is a renter but NOT a parent — only the matching flag surfaces.
      const flags = { ...FLAGS_OFF, isRenter: true };
      const { signals } = service.scoreDirectMaterial(bill, flags);
      expect(signals).toHaveLength(1);
      expect(signals[0].key).toBe('isRenter');
    });

    it('emits one INTEREST_TAG signal per matched topic, preserving slug', () => {
      const bill = mkBill({
        aiSummary: { topics: ['housing', 'transit'], whoItAffects: [] },
      });
      const { signals } = service.scoreValuesAlignment(bill, [
        'housing',
        'transit',
        'climate',
      ]);
      expect(signals.map((s) => s.key)).toEqual(['housing', 'transit']);
      expect(signals.every((s) => s.type === 'interest_tag')).toBe(true);
      expect(signals.every((s) => s.axis === 'valuesAlignment')).toBe(true);
    });

    it('emits an ACTIONABILITY signal tagged with the recency bucket', () => {
      const withinThirty = service.scoreActionability(
        mkBill({ lastActionDate: new Date('2026-06-01T00:00:00Z') }),
        NOW,
      );
      expect(withinThirty.signals).toEqual([
        {
          type: 'actionability',
          key: 'within_30_days',
          axis: 'actionability',
          isSensitive: false,
        },
      ]);

      const withinSixty = service.scoreActionability(
        mkBill({ lastActionDate: new Date('2026-05-01T00:00:00Z') }),
        NOW,
      );
      expect(withinSixty.signals[0].key).toBe('within_60_days');

      const stale = service.scoreActionability(
        mkBill({ lastActionDate: new Date('2026-03-01T00:00:00Z') }),
        NOW,
      );
      expect(stale.signals).toEqual([]);
    });

    it('flags future-scheduled actions with future_action_scheduled', () => {
      const future = service.scoreActionability(
        mkBill({ lastActionDate: new Date('2026-07-01T00:00:00Z') }),
        NOW,
      );
      expect(future.signals[0].key).toBe('future_action_scheduled');
    });

    it('scoreBill aggregates signals from every axis', () => {
      const bill = mkBill({
        lastActionDate: new Date('2026-06-01T00:00:00Z'),
        aiSummary: { topics: ['housing'], whoItAffects: ['renters'] },
      });
      const { signals } = service.scoreBill(
        bill,
        {
          interestTags: ['housing'],
          flags: { ...FLAGS_OFF, isRenter: true },
        },
        NOW,
      );
      expect(signals.map((s) => s.axis)).toEqual([
        'directMaterial',
        'valuesAlignment',
        'actionability',
      ]);
    });

    it('applies per-axis caps so multi-axis evidence stays visible', () => {
      // 6 stakeholder matches + 3 topic matches + 1 actionability tier
      // = 10 candidate signals. With per-axis ceilings of (3, 1, 1)
      // we keep 3 directMaterial + 1 valuesAlignment + 1 actionability
      // for 5 total — multi-axis evidence preserved.
      const bill = mkBill({
        lastActionDate: new Date('2026-06-01T00:00:00Z'),
        aiSummary: {
          topics: ['housing', 'transit', 'climate'],
          whoItAffects: [
            'renters',
            'parents',
            'workers',
            'veterans',
            'drivers',
            'patients',
          ],
        },
      });
      const { signals } = service.scoreBill(
        bill,
        {
          interestTags: ['housing', 'transit', 'climate'],
          flags: {
            ...FLAGS_OFF,
            isRenter: true,
            isParent: true,
            isWorker: true,
            isVeteran: true,
            isDriver: true,
            hasHealthCondition: true,
          },
        },
        NOW,
      );
      expect(signals).toHaveLength(5);
      const axes = signals.map((s) => s.axis);
      expect(axes.filter((a) => a === 'directMaterial')).toHaveLength(3);
      expect(axes.filter((a) => a === 'valuesAlignment')).toHaveLength(1);
      expect(axes.filter((a) => a === 'actionability')).toHaveLength(1);
    });

    it('returns an empty signal array for zero-relevance bills', () => {
      const bill = mkBill({
        aiSummary: { topics: ['agriculture'], whoItAffects: ['farmers'] },
      });
      const { signals } = service.scoreBill(
        bill,
        { interestTags: ['housing'], flags: FLAGS_OFF },
        NOW,
      );
      expect(signals).toEqual([]);
    });
  });
});
