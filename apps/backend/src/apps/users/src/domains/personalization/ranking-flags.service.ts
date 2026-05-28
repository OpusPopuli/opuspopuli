import { Injectable } from '@nestjs/common';
import { SignalProfileService } from './signal-profile.service';
import { SensitiveProfileService } from './sensitive-profile.service';
import type { RankingFlagsModel } from './models/ranking-flags.model';

/**
 * Derives the RankingFlags boolean set for a user without leaking raw
 * T3 values. The knowledge service's ranker queries this via federation;
 * it's the only path that touches SensitiveProfile from outside the
 * users service.
 *
 * Implementation invariants:
 * 1. When `noFieldsMode` is on, every T3-derived flag returns `false`
 *    (no signal, no leakage). T1/T2-derived flags still resolve normally.
 * 2. Missing profile → all flags false (default-deny posture, ranker
 *    handles new users with no signal as "low confidence").
 * 3. This service is a thin derivation layer — no business logic beyond
 *    boolean predicates over scalar field reads.
 *
 * See planning doc §6.3 and issue #743.
 */
@Injectable()
export class RankingFlagsService {
  // Income bands the IncomeBand vocab considers "lower." Conservative
  // here — heuristic for benefits-cliff bills, not means-testing.
  private readonly LOWER_INCOME_BANDS = new Set([
    'under_25k',
    '25k_50k',
    'low',
    'lower_middle',
  ]);

  constructor(
    private readonly signalProfile: SignalProfileService,
    private readonly sensitiveProfile: SensitiveProfileService,
  ) {}

  async getFlagsForUser(userId: string): Promise<RankingFlagsModel> {
    const [signal, sensitiveState] = await Promise.all([
      this.signalProfile.getByUserId(userId),
      this.sensitiveProfile.getState(userId),
    ]);

    // Default-deny base — every flag starts false, only flips when a
    // populated profile field implies it.
    const flags: RankingFlagsModel = {
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

    // ─── T1/T2-derived from SignalProfile ───
    if (signal) {
      flags.isRenter = signal.housingTenure === 'renter';
      flags.isHomeowner = signal.housingTenure === 'owner';
      flags.isParent =
        signal.childrenAgeBands.length > 0 || signal.parentOfStudent.length > 0;
      flags.isCaregiver = signal.hasEldercareDependents === true;
      flags.isStudent = signal.studentLevel != null;
      flags.isEducator = signal.educator === true;

      const workerStatuses = new Set([
        'w2',
        '1099',
        'self_employed',
        'business_owner',
      ]);
      flags.isWorker = workerStatuses.has(signal.employmentStatus ?? '');
      flags.isBusinessOwner = signal.employmentStatus === 'business_owner';
      flags.isUnionMember = signal.unionMember === true;
      flags.isGigWorker = signal.gigWorker === true;
      flags.isTransitRider = signal.primaryTransitMode === 'transit';
      flags.isDriver =
        signal.vehicleTypes.length > 0 &&
        !signal.vehicleTypes.every((v) => v === 'none');
      flags.hasSpecialLicense = signal.specialLicenses.length > 0;
    }

    // ─── T3-derived from SensitiveProfile (masked when no-fields-mode) ───
    if (!sensitiveState.noFieldsMode && sensitiveState.payload) {
      const t3 = sensitiveState.payload;

      const immigrationConcernStatuses = new Set([
        'permanent_resident',
        'daca',
        'visa_holder',
        'undocumented',
        'asylum_seeking',
      ]);
      flags.hasImmigrationConcern = immigrationConcernStatuses.has(
        t3.citizenshipStatus ?? '',
      );

      flags.hasHealthCondition =
        (t3.chronicConditionCategories ?? []).length > 0;

      const publicInsuranceTypes = new Set([
        'medicare',
        'medicaid',
        'va',
        'tricare',
      ]);
      flags.hasPublicHealthInsurance = publicInsuranceTypes.has(
        t3.insuranceType ?? '',
      );

      flags.isVeteran =
        t3.veteranStatus !== undefined &&
        t3.veteranStatus !== null &&
        t3.veteranStatus !== '';
      flags.hasJusticeInvolvement = (t3.justiceInvolvement ?? []).length > 0;
      flags.isLowIncome = this.LOWER_INCOME_BANDS.has(t3.incomeBand ?? '');
      flags.receivesPublicBenefits = (t3.publicBenefits ?? []).length > 0;
    }

    return flags;
  }
}
