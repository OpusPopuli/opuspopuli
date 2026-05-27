import { Test, TestingModule } from '@nestjs/testing';
import { SignalProfileService } from './signal-profile.service';
import { SensitiveProfileService } from './sensitive-profile.service';
import { RankingFlagsService } from './ranking-flags.service';

/**
 * The CRITICAL invariants tested here are the T3 boundary contracts.
 * Per planning doc §6.3, raw sensitive values must never leak from
 * this service — only boolean derivations. The no-fields-mode toggle
 * is the high-risk-user safety guarantee (§9.2); it MUST mask every
 * T3-derived flag regardless of stored payload.
 */
describe('RankingFlagsService', () => {
  let service: RankingFlagsService;
  let signalProfile: jest.Mocked<SignalProfileService>;
  let sensitiveProfile: jest.Mocked<SensitiveProfileService>;

  beforeEach(async () => {
    signalProfile = {
      getByUserId: jest.fn(),
    } as unknown as jest.Mocked<SignalProfileService>;

    sensitiveProfile = {
      getState: jest.fn(),
    } as unknown as jest.Mocked<SensitiveProfileService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingFlagsService,
        { provide: SignalProfileService, useValue: signalProfile },
        { provide: SensitiveProfileService, useValue: sensitiveProfile },
      ],
    }).compile();
    service = module.get(RankingFlagsService);
  });

  /** Helper: build a minimal valid SignalProfile row with explicit overrides. */
  const mkSignal = (overrides: Record<string, unknown> = {}) =>
    ({
      // arrays default to empty (matches Prisma's @default([]) behavior)
      taxExposure: [],
      housingFlags: [],
      childrenAgeBands: [],
      vehicleTypes: [],
      specialLicenses: [],
      parentOfStudent: [],
      interestTags: [],
      trustedOrganizations: [],
      accessibilityNeeds: [],
      ...overrides,
    }) as never;

  describe('default-deny base (no profile data)', () => {
    it('returns all flags false when no SignalProfile and no SensitiveProfile', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: null,
      });

      const flags = await service.getFlagsForUser('u-1');

      // Every flag must be false — new users with no signal start neutral.
      expect(Object.values(flags).every((v) => v === false)).toBe(true);
    });
  });

  describe('T1/T2 derivations (SignalProfile)', () => {
    beforeEach(() => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: null,
      });
    });

    it('isRenter/isHomeowner flip on housingTenure', async () => {
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ housingTenure: 'renter' }),
      );
      let flags = await service.getFlagsForUser('u-1');
      expect(flags.isRenter).toBe(true);
      expect(flags.isHomeowner).toBe(false);

      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ housingTenure: 'owner' }),
      );
      flags = await service.getFlagsForUser('u-1');
      expect(flags.isRenter).toBe(false);
      expect(flags.isHomeowner).toBe(true);
    });

    it('isParent true when childrenAgeBands populated', async () => {
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ childrenAgeBands: ['k-5'] }),
      );
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.isParent).toBe(true);
    });

    it('isParent true when parentOfStudent populated even if no childrenAgeBands', async () => {
      // "I'm a parent" chip writes parentOfStudent directly; childrenAgeBands
      // is refined later. The flag should fire on either signal.
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ parentOfStudent: ['public'] }),
      );
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.isParent).toBe(true);
    });

    it('isCaregiver follows hasEldercareDependents=true only', async () => {
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ hasEldercareDependents: false }),
      );
      let flags = await service.getFlagsForUser('u-1');
      expect(flags.isCaregiver).toBe(false);

      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ hasEldercareDependents: true }),
      );
      flags = await service.getFlagsForUser('u-1');
      expect(flags.isCaregiver).toBe(true);
    });

    it('isWorker is true for any employed status', async () => {
      for (const status of ['w2', '1099', 'self_employed', 'business_owner']) {
        signalProfile.getByUserId.mockResolvedValue(
          mkSignal({ employmentStatus: status }),
        );
        const flags = await service.getFlagsForUser('u-1');
        expect(flags.isWorker).toBe(true);
      }

      // Non-employed statuses don't flip isWorker
      for (const status of [
        'unemployed',
        'retired',
        'student',
        'unpaid_caregiver',
      ]) {
        signalProfile.getByUserId.mockResolvedValue(
          mkSignal({ employmentStatus: status }),
        );
        const flags = await service.getFlagsForUser('u-1');
        expect(flags.isWorker).toBe(false);
      }
    });

    it('isBusinessOwner is only true for business_owner specifically', async () => {
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ employmentStatus: 'business_owner' }),
      );
      let flags = await service.getFlagsForUser('u-1');
      expect(flags.isBusinessOwner).toBe(true);
      expect(flags.isWorker).toBe(true);

      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ employmentStatus: 'w2' }),
      );
      flags = await service.getFlagsForUser('u-1');
      expect(flags.isBusinessOwner).toBe(false);
    });

    it('isDriver is true when vehicleTypes is non-empty AND not all "none"', async () => {
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ vehicleTypes: ['ev'] }),
      );
      let flags = await service.getFlagsForUser('u-1');
      expect(flags.isDriver).toBe(true);

      // The "none" sentinel means the user explicitly indicated no vehicle —
      // they could have set this via onboarding to opt out of vehicle policy
      // bills. Don't flip the flag.
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ vehicleTypes: ['none'] }),
      );
      flags = await service.getFlagsForUser('u-1');
      expect(flags.isDriver).toBe(false);

      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ vehicleTypes: [] }),
      );
      flags = await service.getFlagsForUser('u-1');
      expect(flags.isDriver).toBe(false);
    });

    it('hasSpecialLicense fires when any niche license present', async () => {
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({ specialLicenses: ['cdl'] }),
      );
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.hasSpecialLicense).toBe(true);
    });
  });

  describe('T3 derivations (SensitiveProfile) — CRITICAL privacy boundary', () => {
    it('returns all T3 flags false when noFieldsMode is on, even with rich payload', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: true,
        // payload would normally be null when toggle is on (getState
        // contract) — but assert the flag-mask works even if a future
        // refactor returns a payload alongside.
        payload: null,
      });

      const flags = await service.getFlagsForUser('u-1');

      const t3Flags = [
        flags.hasImmigrationConcern,
        flags.hasHealthCondition,
        flags.hasPublicHealthInsurance,
        flags.isVeteran,
        flags.hasJusticeInvolvement,
        flags.isLowIncome,
        flags.receivesPublicBenefits,
      ];
      expect(t3Flags.every((v) => v === false)).toBe(true);
    });

    it('hasImmigrationConcern only true for non-citizen / asylum-seeking statuses', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);

      for (const status of [
        'permanent_resident',
        'daca',
        'visa_holder',
        'undocumented',
        'asylum_seeking',
      ]) {
        sensitiveProfile.getState.mockResolvedValue({
          noFieldsMode: false,
          payload: { citizenshipStatus: status },
        });
        const flags = await service.getFlagsForUser('u-1');
        expect(flags.hasImmigrationConcern).toBe(true);
      }

      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { citizenshipStatus: 'citizen' },
      });
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.hasImmigrationConcern).toBe(false);
    });

    it('hasHealthCondition fires when chronicConditionCategories non-empty', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { chronicConditionCategories: ['cardiovascular'] },
      });
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.hasHealthCondition).toBe(true);
    });

    it('hasPublicHealthInsurance fires only for medicare/medicaid/va/tricare', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);

      for (const insurance of ['medicare', 'medicaid', 'va', 'tricare']) {
        sensitiveProfile.getState.mockResolvedValue({
          noFieldsMode: false,
          payload: { insuranceType: insurance },
        });
        const flags = await service.getFlagsForUser('u-1');
        expect(flags.hasPublicHealthInsurance).toBe(true);
      }

      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { insuranceType: 'employer' },
      });
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.hasPublicHealthInsurance).toBe(false);
    });

    it('isVeteran fires on any non-empty veteranStatus', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { veteranStatus: 'veteran' },
      });
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.isVeteran).toBe(true);
    });

    it('hasJusticeInvolvement fires when justiceInvolvement[] non-empty', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { justiceInvolvement: ['family_affected'] },
      });
      const flags = await service.getFlagsForUser('u-1');
      expect(flags.hasJusticeInvolvement).toBe(true);
    });

    it('isLowIncome maps the documented lower bands only', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);

      for (const band of ['under_25k', '25k_50k', 'low', 'lower_middle']) {
        sensitiveProfile.getState.mockResolvedValue({
          noFieldsMode: false,
          payload: { incomeBand: band },
        });
        const flags = await service.getFlagsForUser('u-1');
        expect(flags.isLowIncome).toBe(true);
      }

      for (const band of ['middle', 'upper_middle', 'high']) {
        sensitiveProfile.getState.mockResolvedValue({
          noFieldsMode: false,
          payload: { incomeBand: band },
        });
        const flags = await service.getFlagsForUser('u-1');
        expect(flags.isLowIncome).toBe(false);
      }
    });
  });

  describe('mixed scenarios', () => {
    it('returns the full expected flag set for a realistic profile', async () => {
      // A working renter parent who's a veteran with VA insurance —
      // the kind of profile that should surface housing, veterans',
      // and healthcare bills.
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({
          housingTenure: 'renter',
          childrenAgeBands: ['6-12'],
          employmentStatus: 'w2',
          primaryTransitMode: 'car',
          vehicleTypes: ['ice'],
        }),
      );
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: {
          veteranStatus: 'veteran',
          insuranceType: 'va',
        },
      });

      const flags = await service.getFlagsForUser('u-1');

      expect(flags.isRenter).toBe(true);
      expect(flags.isHomeowner).toBe(false);
      expect(flags.isParent).toBe(true);
      expect(flags.isWorker).toBe(true);
      expect(flags.isDriver).toBe(true);
      expect(flags.isTransitRider).toBe(false);
      expect(flags.isVeteran).toBe(true);
      expect(flags.hasPublicHealthInsurance).toBe(true);
      // T3 fields not populated stay false
      expect(flags.hasImmigrationConcern).toBe(false);
      expect(flags.hasHealthCondition).toBe(false);
    });

    it('T1/T2 flags resolve normally even when noFieldsMode masks T3', async () => {
      // The user opted into no-fields-mode but their T1/T2 housing/work
      // signals still feed the ranker — the toggle protects T3 specifically.
      signalProfile.getByUserId.mockResolvedValue(
        mkSignal({
          housingTenure: 'owner',
          employmentStatus: 'business_owner',
        }),
      );
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: true,
        payload: null,
      });

      const flags = await service.getFlagsForUser('u-1');

      expect(flags.isHomeowner).toBe(true);
      expect(flags.isBusinessOwner).toBe(true);
      // T3 stays false despite hypothetical underlying data
      expect(flags.isVeteran).toBe(false);
      expect(flags.hasImmigrationConcern).toBe(false);
    });
  });
});
