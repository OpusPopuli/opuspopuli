import { gql } from "@apollo/client";

// ============================================
// SignalProfile (T1 + T2). #758 onboarding + #752 model-of-me both
// consume this; queries select every model field so the model-of-me
// edit page can render and edit any of them. Backend resolver always
// returns the full row, so over-fetching cost is negligible.
// ============================================

// convictionStrength (JSON map { tag → strength }) is intentionally
// not exposed at the frontend until the per-tag edit UI lands — see
// the deferral note in `lib/personalization/vocab.ts`.

export interface SignalProfile {
  id: string;
  userId: string;
  // §4.2 Housing
  housingTenure?: string | null;
  buildingType?: string | null;
  taxExposure: string[];
  housingFlags: string[];
  // §4.3 Household
  childrenAgeBands: string[];
  hasEldercareDependents?: boolean | null;
  multigenerational?: boolean | null;
  hasPets?: boolean | null;
  partnerStatus?: string | null;
  // §4.4 Work
  employmentStatus?: string | null;
  industry?: string | null;
  occupationCategory?: string | null;
  employerSizeBand?: string | null;
  unionMember?: boolean | null;
  gigWorker?: boolean | null;
  tippedWorker?: boolean | null;
  // §4.6 Transportation
  primaryTransitMode?: string | null;
  vehicleTypes: string[];
  commuteBand?: string | null;
  specialLicenses: string[];
  transitPassHolder?: boolean | null;
  bikeShareMember?: boolean | null;
  // §4.7 Education
  studentLevel?: string | null;
  parentOfStudent: string[];
  educator?: boolean | null;
  // §4.10 Declared values
  interestTags: string[];
  politicalSelfId?: string | null;
  // §4.11 Affiliations
  trustedOrganizations: string[];
  unionAffiliation?: string | null;
  faithCommunity?: string | null;
  // §4.13 Attention & format
  weeklyAttentionMinutes?: number | null;
  preferredDepth?: string | null;
  accessibilityNeeds: string[];
  readingLevel?: string | null;
  // §4.14 Relational
  agingParentsState?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Mutation input for `updateMySignalProfile`. Every editable field is
 * optional and follows the same per-field shape as the read model —
 * derived as a `Partial<>` so adding/removing fields in `SignalProfile`
 * keeps both sides in lockstep without duplicate maintenance.
 */
export type UpdateSignalProfileInput = Partial<
  Omit<SignalProfile, "id" | "userId" | "createdAt" | "updatedAt">
>;

export interface MySignalProfileData {
  mySignalProfile: SignalProfile | null;
}

export interface UpdateMySignalProfileData {
  updateMySignalProfile: SignalProfile;
}

const SIGNAL_PROFILE_SELECTION = `
  id
  userId
  housingTenure
  buildingType
  taxExposure
  housingFlags
  childrenAgeBands
  hasEldercareDependents
  multigenerational
  hasPets
  partnerStatus
  employmentStatus
  industry
  occupationCategory
  employerSizeBand
  unionMember
  gigWorker
  tippedWorker
  primaryTransitMode
  vehicleTypes
  commuteBand
  specialLicenses
  transitPassHolder
  bikeShareMember
  studentLevel
  parentOfStudent
  educator
  interestTags
  politicalSelfId
  trustedOrganizations
  unionAffiliation
  faithCommunity
  weeklyAttentionMinutes
  preferredDepth
  accessibilityNeeds
  readingLevel
  agingParentsState
`;

export const GET_MY_SIGNAL_PROFILE = gql`
  query MySignalProfile {
    mySignalProfile {
      ${SIGNAL_PROFILE_SELECTION}
    }
  }
`;

export const UPDATE_MY_SIGNAL_PROFILE = gql`
  mutation UpdateMySignalProfile($input: UpdateSignalProfileDto!) {
    updateMySignalProfile(input: $input) {
      ${SIGNAL_PROFILE_SELECTION}
    }
  }
`;

// ============================================
// SensitiveProfile (T3, encrypted at rest). The resolver returns
// `noFieldsMode: true` and every other field null when the toggle is
// on — the privacy contract from planning doc §9.2.
// ============================================

export interface SensitiveProfile {
  noFieldsMode: boolean;
  incomeBand?: string | null;
  publicBenefits?: string[] | null;
  insuranceType?: string | null;
  chronicConditionCategories?: string[] | null;
  caregiverFor?: string[] | null;
  reproductiveHealthRelevance?: boolean | null;
  citizenshipStatus?: string | null;
  veteranStatus?: string | null;
  justiceInvolvement?: string[] | null;
  raceEthnicity?: string[] | null;
  primaryLanguages?: string[] | null;
  religiousCommunity?: string | null;
  lgbtqIdentity?: string | null;
  immigrationGeneration?: number | null;
  tribalAffiliation?: string | null;
}

/**
 * Mutation input for `updateMySensitiveProfile`. Mirrors
 * `SensitiveProfile` minus the toggle (which has its own mutation),
 * normalized to nullable-or-empty so callers can clear individual
 * fields without touching the rest.
 */
export type UpdateSensitiveProfileInput = Partial<
  Omit<SensitiveProfile, "noFieldsMode">
>;

export interface MySensitiveProfileData {
  mySensitiveProfile: SensitiveProfile;
}

export interface UpdateMySensitiveProfileData {
  updateMySensitiveProfile: SensitiveProfile;
}

export interface SetMyNoFieldsModeData {
  setMyNoFieldsMode: SensitiveProfile;
}

const SENSITIVE_PROFILE_SELECTION = `
  noFieldsMode
  incomeBand
  publicBenefits
  insuranceType
  chronicConditionCategories
  caregiverFor
  reproductiveHealthRelevance
  citizenshipStatus
  veteranStatus
  justiceInvolvement
  raceEthnicity
  primaryLanguages
  religiousCommunity
  lgbtqIdentity
  immigrationGeneration
  tribalAffiliation
`;

export const GET_MY_SENSITIVE_PROFILE = gql`
  query MySensitiveProfile {
    mySensitiveProfile {
      ${SENSITIVE_PROFILE_SELECTION}
    }
  }
`;

export const UPDATE_MY_SENSITIVE_PROFILE = gql`
  mutation UpdateMySensitiveProfile($input: UpdateSensitiveProfileDto!) {
    updateMySensitiveProfile(input: $input) {
      ${SENSITIVE_PROFILE_SELECTION}
    }
  }
`;

export const SET_MY_NO_FIELDS_MODE = gql`
  mutation SetMyNoFieldsMode($on: Boolean!) {
    setMyNoFieldsMode(on: $on) {
      ${SENSITIVE_PROFILE_SELECTION}
    }
  }
`;

// The backend exposes `clearMySensitiveProfile` (wipes the entire T3
// blob in one call) but #752 deliberately doesn't surface it — the
// per-field Clear affordance covers the user-facing intent. A full-
// wipe affordance is a planning-doc §8.1 v1.1 follow-up (#759).
