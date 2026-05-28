import { gql } from "@apollo/client";

// ============================================
// SignalProfile (T1 + T2) — mirrors UpdateSignalProfileDto fields the
// onboarding flow writes to. Backend exposes many more; we include only
// the slice the onboarding chip vocabulary maps onto (#758).
// ============================================

export interface UpdateSignalProfileInput {
  housingTenure?: string;
  hasEldercareDependents?: boolean;
  parentOfStudent?: string[];
  employmentStatus?: string;
  unionMember?: boolean;
  primaryTransitMode?: string;
  studentLevel?: string;
  educator?: boolean;
  interestTags?: string[];
}

export interface SignalProfile {
  id: string;
  userId: string;
  housingTenure?: string;
  hasEldercareDependents?: boolean;
  parentOfStudent?: string[];
  employmentStatus?: string;
  unionMember?: boolean;
  primaryTransitMode?: string;
  studentLevel?: string;
  educator?: boolean;
  interestTags?: string[];
}

export interface MySignalProfileData {
  mySignalProfile: SignalProfile | null;
}

export interface UpdateMySignalProfileData {
  updateMySignalProfile: SignalProfile;
}

export const GET_MY_SIGNAL_PROFILE = gql`
  query MySignalProfile {
    mySignalProfile {
      id
      userId
      housingTenure
      hasEldercareDependents
      parentOfStudent
      employmentStatus
      unionMember
      primaryTransitMode
      studentLevel
      educator
      interestTags
    }
  }
`;

export const UPDATE_MY_SIGNAL_PROFILE = gql`
  mutation UpdateMySignalProfile($input: UpdateSignalProfileDto!) {
    updateMySignalProfile(input: $input) {
      id
      userId
      housingTenure
      hasEldercareDependents
      parentOfStudent
      employmentStatus
      unionMember
      primaryTransitMode
      studentLevel
      educator
      interestTags
    }
  }
`;

// ============================================
// SensitiveProfile (T3, encrypted at rest). Onboarding only ever writes
// `veteranStatus` directly; other T3 fields are reserved for the
// model-of-me settings page (#752) where the disclosure scaffolding is
// richer.
// ============================================

export interface UpdateSensitiveProfileInput {
  veteranStatus?: string;
}

export interface SensitiveProfile {
  noFieldsMode: boolean;
  veteranStatus?: string;
}

export interface MySensitiveProfileData {
  mySensitiveProfile: SensitiveProfile;
}

export interface UpdateMySensitiveProfileData {
  updateMySensitiveProfile: SensitiveProfile;
}

export interface SetMyNoFieldsModeData {
  setMyNoFieldsMode: SensitiveProfile;
}

export const GET_MY_SENSITIVE_PROFILE = gql`
  query MySensitiveProfile {
    mySensitiveProfile {
      noFieldsMode
      veteranStatus
    }
  }
`;

export const UPDATE_MY_SENSITIVE_PROFILE = gql`
  mutation UpdateMySensitiveProfile($input: UpdateSensitiveProfileDto!) {
    updateMySensitiveProfile(input: $input) {
      noFieldsMode
      veteranStatus
    }
  }
`;

export const SET_MY_NO_FIELDS_MODE = gql`
  mutation SetMyNoFieldsMode($on: Boolean!) {
    setMyNoFieldsMode(on: $on) {
      noFieldsMode
      veteranStatus
    }
  }
`;
