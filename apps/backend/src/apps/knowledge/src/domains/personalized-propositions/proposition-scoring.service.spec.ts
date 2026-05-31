import { Test, TestingModule } from '@nestjs/testing';
import {
  PropositionScoringService,
  type RankableProposition,
} from './proposition-scoring.service';
import type { PropositionPersonalizationInputDto } from './dto/proposition-personalization-input.dto';

const FLAGS_OFF: PropositionPersonalizationInputDto['flags'] = {
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

const baseProp = (
  overrides: Partial<RankableProposition> = {},
): RankableProposition => ({
  id: 'p-1',
  electionDate: new Date('2026-11-03T00:00:00Z'),
  searchableText: '',
  ...overrides,
});

describe('PropositionScoringService', () => {
  let service: PropositionScoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PropositionScoringService],
    }).compile();
    service = module.get(PropositionScoringService);
  });

  describe('scoreDirectMaterial (axis 1)', () => {
    it('returns 0 when the proposition has no searchable text', () => {
      expect(
        service.scoreDirectMaterial(baseProp({ searchableText: '' }), {
          ...FLAGS_OFF,
          isRenter: true,
        }),
      ).toBe(0);
    });

    it('returns 0 when the user has no flags declared', () => {
      expect(
        service.scoreDirectMaterial(
          baseProp({
            searchableText: 'affordable housing for renters and tenants',
          }),
          FLAGS_OFF,
        ),
      ).toBe(0);
    });

    it('scores 0.2 per matched flag', () => {
      const prop = baseProp({
        searchableText: 'protects renters and workers in california',
      });
      const flags = { ...FLAGS_OFF, isRenter: true, isWorker: true };
      expect(service.scoreDirectMaterial(prop, flags)).toBeCloseTo(0.4);
    });

    it('caps at 1.0 even when many flags match', () => {
      const prop = baseProp({
        searchableText:
          'renter homeowner parent student worker patient veteran low-income immigration medicaid',
      });
      const flags = {
        ...FLAGS_OFF,
        isRenter: true,
        isHomeowner: true,
        isParent: true,
        isStudent: true,
        isWorker: true,
        hasHealthCondition: true,
        isVeteran: true,
        isLowIncome: true,
        hasImmigrationConcern: true,
        hasPublicHealthInsurance: true,
      };
      expect(service.scoreDirectMaterial(prop, flags)).toBe(1.0);
    });

    it('honors word boundaries — "renter" does not match "rentier" or "rental car"', () => {
      const prop = baseProp({
        searchableText: 'rentier capitalism and rental cars not in scope',
      });
      const flags = { ...FLAGS_OFF, isRenter: true };
      // Neither "rentier" (no word break before "renter") nor "rental"
      // (different word) should fire.
      expect(service.scoreDirectMaterial(prop, flags)).toBe(0);
    });

    it('matches plural keywords (renters, workers, students)', () => {
      const prop = baseProp({
        searchableText: 'helps students access higher education',
      });
      const flags = { ...FLAGS_OFF, isStudent: true };
      expect(service.scoreDirectMaterial(prop, flags)).toBeCloseTo(0.2);
    });

    it('matches hyphenated keywords like "medi-cal" and "low-income"', () => {
      const prop = baseProp({
        searchableText: 'expands medi-cal coverage for low-income californians',
      });
      const flags = {
        ...FLAGS_OFF,
        hasPublicHealthInsurance: true,
        isLowIncome: true,
      };
      expect(service.scoreDirectMaterial(prop, flags)).toBeCloseTo(0.4);
    });

    it('is case-insensitive', () => {
      const prop = baseProp({ searchableText: 'PROTECTS RENTERS' });
      const flags = { ...FLAGS_OFF, isRenter: true };
      expect(service.scoreDirectMaterial(prop, flags)).toBeCloseTo(0.2);
    });
  });

  describe('scoreValuesAlignment (axis 2)', () => {
    it('returns 0 when interest tags are empty', () => {
      const prop = baseProp({ searchableText: 'housing reform' });
      expect(service.scoreValuesAlignment(prop, [])).toBe(0);
    });

    it('returns 1.0 when single interest matches single occurrence', () => {
      const prop = baseProp({ searchableText: 'housing affordability act' });
      expect(service.scoreValuesAlignment(prop, ['housing'])).toBe(1.0);
    });

    it('normalizes by user interest count — 1 match out of 3 interests = 0.33', () => {
      const prop = baseProp({ searchableText: 'housing affordability' });
      expect(
        service.scoreValuesAlignment(prop, [
          'housing',
          'healthcare',
          'justice',
        ]),
      ).toBeCloseTo(1 / 3);
    });

    it('matches multiple interests when both appear', () => {
      const prop = baseProp({
        searchableText: 'housing and healthcare access reform',
      });
      expect(
        service.scoreValuesAlignment(prop, ['housing', 'healthcare']),
      ).toBe(1.0);
    });

    it('honors word boundaries on interest tags', () => {
      const prop = baseProp({ searchableText: 'farmhouse renovations' });
      // "housing" should NOT match inside "farmhouse"
      expect(service.scoreValuesAlignment(prop, ['housing'])).toBe(0);
    });
  });

  describe('scoreElectionProximity (axis 3)', () => {
    const now = new Date('2026-10-01T00:00:00Z');

    it('returns 0 for past elections', () => {
      const prop = baseProp({ electionDate: new Date('2026-09-01T00:00:00Z') });
      expect(service.scoreElectionProximity(prop, now)).toBe(0);
    });

    it('returns 0 when no election date is set', () => {
      expect(
        service.scoreElectionProximity(baseProp({ electionDate: null }), now),
      ).toBe(0);
    });

    it('peaks at 1.0 inside the 30-day urgent window', () => {
      const prop = baseProp({ electionDate: new Date('2026-10-15T00:00:00Z') }); // 14d
      expect(service.scoreElectionProximity(prop, now)).toBe(1.0);
    });

    it('returns 1.0 on election day exactly', () => {
      const prop = baseProp({ electionDate: now });
      expect(service.scoreElectionProximity(prop, now)).toBe(1.0);
    });

    it('decays linearly between 30 and 90 days (1.0 → 0.4)', () => {
      // 60 days out — midpoint of 30-90 band → ~0.7
      const prop = baseProp({
        electionDate: new Date('2026-11-30T00:00:00Z'),
      });
      const score = service.scoreElectionProximity(prop, now);
      expect(score).toBeGreaterThan(0.6);
      expect(score).toBeLessThan(0.8);
    });

    it('decays further between 90 and 365 days (0.4 → 0.0)', () => {
      // 200 days out — well inside the long-tail band → < 0.4
      const prop = baseProp({
        electionDate: new Date('2027-04-19T00:00:00Z'),
      });
      const score = service.scoreElectionProximity(prop, now);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.4);
    });

    it('returns 0 for elections more than a year out', () => {
      const prop = baseProp({ electionDate: new Date('2028-01-01T00:00:00Z') });
      expect(service.scoreElectionProximity(prop, now)).toBe(0);
    });
  });

  describe('scoreProposition (composite)', () => {
    it('combines all three axes with the 50/30/20 weighting', () => {
      const prop = baseProp({
        searchableText: 'housing reform protects renters',
        electionDate: new Date('2026-10-15T00:00:00Z'),
      });
      const input: PropositionPersonalizationInputDto = {
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      };
      const now = new Date('2026-10-01T00:00:00Z');

      const { axisScores, composite } = service.scoreProposition(
        prop,
        input,
        now,
      );

      expect(axisScores.directMaterial).toBeCloseTo(0.2);
      expect(axisScores.valuesAlignment).toBe(1.0);
      expect(axisScores.actionability).toBe(1.0);
      // 0.2 * 0.5 + 1.0 * 0.3 + 1.0 * 0.2 = 0.1 + 0.3 + 0.2 = 0.6
      expect(composite).toBeCloseTo(0.6);
    });

    it('placeholder axes (4-7) stay at 0 in v1.0', () => {
      const prop = baseProp({ searchableText: 'anything' });
      const { axisScores } = service.scoreProposition(
        prop,
        { interestTags: [], flags: FLAGS_OFF },
        new Date(),
      );
      expect(axisScores.indirectMaterial).toBe(0);
      expect(axisScores.coalitionSignal).toBe(0);
      expect(axisScores.counterfactual).toBe(0);
      expect(axisScores.noveltyRepetition).toBe(0);
    });

    it('composite is 0 for a prop with no overlap and no proximity', () => {
      const prop = baseProp({
        searchableText: 'unrelated topic',
        electionDate: new Date('2028-01-01T00:00:00Z'),
      });
      const { composite } = service.scoreProposition(
        prop,
        { interestTags: ['housing'], flags: FLAGS_OFF },
        new Date('2026-10-01T00:00:00Z'),
      );
      expect(composite).toBe(0);
    });
  });
});
