import { gql } from "@apollo/client";

// ============================================
// Types
// ============================================

export type SupportedLanguage = "en" | "es";

// Profile Enhancement Enums
export type PoliticalAffiliation =
  | "democrat"
  | "republican"
  | "independent"
  | "libertarian"
  | "green"
  | "other"
  | "prefer_not_to_say";

export type VotingFrequency =
  | "every_election"
  | "most_elections"
  | "some_elections"
  | "rarely"
  | "never"
  | "prefer_not_to_say";

export type EducationLevel =
  | "high_school"
  | "some_college"
  | "associate"
  | "bachelor"
  | "master"
  | "doctorate"
  | "trade_school"
  | "prefer_not_to_say";

export type IncomeRange =
  | "under_25k"
  | "25k_50k"
  | "50k_75k"
  | "75k_100k"
  | "100k_150k"
  | "150k_200k"
  | "over_200k"
  | "prefer_not_to_say";

export type HomeownerStatus =
  | "own"
  | "rent"
  | "living_with_family"
  | "other"
  | "prefer_not_to_say";

// Profile Completion Types
export interface CoreFieldsStatus {
  hasName: boolean;
  hasPhoto: boolean;
  hasTimezone: boolean;
  hasAddress: boolean;
}

export interface ProfileCompletion {
  percentage: number;
  isComplete: boolean;
  coreFieldsComplete: CoreFieldsStatus;
  suggestedNextSteps: string[];
}

export interface UserProfile {
  id: string;
  userId: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  displayName?: string;
  preferredName?: string;
  dateOfBirth?: string;
  phone?: string;
  phoneVerifiedAt?: string;
  timezone: string;
  locale: string;
  preferredLanguage: SupportedLanguage;
  avatarUrl?: string;
  avatarStorageKey?: string;
  bio?: string;
  // Profile Visibility
  isPublic: boolean;
  // Civic Fields
  politicalAffiliation?: PoliticalAffiliation;
  votingFrequency?: VotingFrequency;
  policyPriorities?: string[];
  // Demographic Fields
  occupation?: string;
  educationLevel?: EducationLevel;
  incomeRange?: IncomeRange;
  householdSize?: string;
  homeownerStatus?: HomeownerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  displayName?: string;
  preferredName?: string;
  dateOfBirth?: string;
  phone?: string;
  timezone?: string;
  locale?: string;
  preferredLanguage?: SupportedLanguage;
  avatarUrl?: string;
  avatarStorageKey?: string;
  bio?: string;
  // Profile Visibility
  isPublic?: boolean;
  // Civic Fields
  politicalAffiliation?: PoliticalAffiliation;
  votingFrequency?: VotingFrequency;
  policyPriorities?: string[];
  // Demographic Fields
  occupation?: string;
  educationLevel?: EducationLevel;
  incomeRange?: IncomeRange;
  householdSize?: string;
  homeownerStatus?: HomeownerStatus;
}

export type AddressType = "residential" | "mailing" | "business" | "voting";

export interface UserAddress {
  id: string;
  userId: string;
  addressType: AddressType;
  isPrimary: boolean;
  label?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  congressionalDistrict?: string;
  stateSenatorialDistrict?: string;
  stateAssemblyDistrict?: string;
  county?: string;
  municipality?: string;
  schoolDistrict?: string;
  precinctId?: string;
  pollingPlace?: string;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAddressInput {
  addressType: AddressType;
  isPrimary?: boolean;
  label?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

export interface UpdateAddressInput {
  id: string;
  addressType?: AddressType;
  isPrimary?: boolean;
  label?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export type NotificationFrequency =
  | "immediate"
  | "daily_digest"
  | "weekly_digest"
  | "never";

export interface NotificationPreferences {
  id: string;
  userId: string;
  emailEnabled: boolean;
  emailProductUpdates: boolean;
  emailSecurityAlerts: boolean;
  emailMarketing: boolean;
  emailFrequency: NotificationFrequency;
  pushEnabled: boolean;
  pushProductUpdates: boolean;
  pushSecurityAlerts: boolean;
  pushMarketing: boolean;
  smsEnabled: boolean;
  smsSecurityAlerts: boolean;
  smsMarketing: boolean;
  civicElectionReminders: boolean;
  civicVoterDeadlines: boolean;
  civicBallotUpdates: boolean;
  civicLocalNews: boolean;
  civicRepresentativeUpdates: boolean;
  civicFrequency: NotificationFrequency;
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationPreferencesInput {
  emailEnabled?: boolean;
  emailProductUpdates?: boolean;
  emailSecurityAlerts?: boolean;
  emailMarketing?: boolean;
  emailFrequency?: NotificationFrequency;
  pushEnabled?: boolean;
  pushProductUpdates?: boolean;
  pushSecurityAlerts?: boolean;
  pushMarketing?: boolean;
  smsEnabled?: boolean;
  smsSecurityAlerts?: boolean;
  smsMarketing?: boolean;
  civicElectionReminders?: boolean;
  civicVoterDeadlines?: boolean;
  civicBallotUpdates?: boolean;
  civicLocalNews?: boolean;
  civicRepresentativeUpdates?: boolean;
  civicFrequency?: NotificationFrequency;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

export type ConsentType =
  | "terms_of_service"
  | "privacy_policy"
  | "marketing_email"
  | "marketing_sms"
  | "marketing_push"
  | "data_sharing"
  | "analytics"
  | "personalization"
  | "location_tracking"
  | "voter_data_collection"
  | "civic_notifications"
  | "representative_contact";

export type ConsentStatus = "granted" | "denied" | "withdrawn" | "pending";

export interface UserConsent {
  id: string;
  userId: string;
  consentType: ConsentType;
  status: ConsentStatus;
  documentVersion?: string;
  documentUrl?: string;
  grantedAt?: string;
  deniedAt?: string;
  withdrawnAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateConsentInput {
  consentType: ConsentType;
  granted: boolean;
  documentVersion?: string;
  documentUrl?: string;
}

// ============================================
// Profile Queries & Mutations
// ============================================

export const GET_MY_PROFILE = gql`
  query MyProfile {
    myProfile {
      id
      userId
      firstName
      middleName
      lastName
      displayName
      preferredName
      dateOfBirth
      phone
      phoneVerifiedAt
      timezone
      locale
      preferredLanguage
      avatarUrl
      avatarStorageKey
      bio
      isPublic
      politicalAffiliation
      votingFrequency
      policyPriorities
      occupation
      educationLevel
      incomeRange
      householdSize
      homeownerStatus
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_MY_PROFILE = gql`
  mutation UpdateMyProfile($input: UpdateProfileDto!) {
    updateMyProfile(input: $input) {
      id
      userId
      firstName
      middleName
      lastName
      displayName
      preferredName
      dateOfBirth
      phone
      timezone
      locale
      preferredLanguage
      avatarUrl
      avatarStorageKey
      bio
      isPublic
      politicalAffiliation
      votingFrequency
      policyPriorities
      occupation
      educationLevel
      incomeRange
      householdSize
      homeownerStatus
      updatedAt
    }
  }
`;

// ============================================
// Profile Completion Queries
// ============================================

export const GET_MY_PROFILE_COMPLETION = gql`
  query MyProfileCompletion {
    myProfileCompletion {
      percentage
      isComplete
      coreFieldsComplete {
        hasName
        hasPhoto
        hasTimezone
        hasAddress
      }
      suggestedNextSteps
    }
  }
`;

// ============================================
// Avatar Upload Queries & Mutations
// ============================================

export const GET_AVATAR_UPLOAD_URL = gql`
  query AvatarUploadUrl($filename: String!) {
    avatarUploadUrl(filename: $filename)
  }
`;

export const UPDATE_AVATAR_STORAGE_KEY = gql`
  mutation UpdateAvatarStorageKey($storageKey: String!) {
    updateAvatarStorageKey(storageKey: $storageKey) {
      id
      avatarUrl
      avatarStorageKey
    }
  }
`;

// ============================================
// Address Queries & Mutations
// ============================================

export const GET_MY_ADDRESSES = gql`
  query MyAddresses {
    myAddresses {
      id
      userId
      addressType
      isPrimary
      label
      addressLine1
      addressLine2
      city
      state
      postalCode
      country
      latitude
      longitude
      formattedAddress
      congressionalDistrict
      stateSenatorialDistrict
      stateAssemblyDistrict
      county
      municipality
      schoolDistrict
      precinctId
      pollingPlace
      isVerified
      createdAt
      updatedAt
    }
  }
`;

export const CREATE_ADDRESS = gql`
  mutation CreateAddress($input: CreateAddressDto!) {
    createAddress(input: $input) {
      id
      addressType
      isPrimary
      label
      addressLine1
      addressLine2
      city
      state
      postalCode
      country
      isVerified
      createdAt
    }
  }
`;

export const UPDATE_ADDRESS = gql`
  mutation UpdateAddress($input: UpdateAddressDto!) {
    updateAddress(input: $input) {
      id
      addressType
      isPrimary
      label
      addressLine1
      addressLine2
      city
      state
      postalCode
      country
      updatedAt
    }
  }
`;

export const DELETE_ADDRESS = gql`
  mutation DeleteAddress($id: ID!) {
    deleteAddress(id: $id)
  }
`;

export const SET_PRIMARY_ADDRESS = gql`
  mutation SetPrimaryAddress($id: ID!) {
    setPrimaryAddress(id: $id) {
      id
      isPrimary
    }
  }
`;

// ============================================
// Notification Preferences Queries & Mutations
// ============================================

export const GET_MY_NOTIFICATION_PREFERENCES = gql`
  query MyNotificationPreferences {
    myNotificationPreferences {
      id
      userId
      emailEnabled
      emailProductUpdates
      emailSecurityAlerts
      emailMarketing
      emailFrequency
      pushEnabled
      pushProductUpdates
      pushSecurityAlerts
      pushMarketing
      smsEnabled
      smsSecurityAlerts
      smsMarketing
      civicElectionReminders
      civicVoterDeadlines
      civicBallotUpdates
      civicLocalNews
      civicRepresentativeUpdates
      civicFrequency
      quietHoursEnabled
      quietHoursStart
      quietHoursEnd
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_NOTIFICATION_PREFERENCES = gql`
  mutation UpdateNotificationPreferences(
    $input: UpdateNotificationPreferencesDto!
  ) {
    updateNotificationPreferences(input: $input) {
      id
      emailEnabled
      emailProductUpdates
      emailSecurityAlerts
      emailMarketing
      emailFrequency
      pushEnabled
      pushProductUpdates
      pushSecurityAlerts
      pushMarketing
      smsEnabled
      smsSecurityAlerts
      smsMarketing
      civicElectionReminders
      civicVoterDeadlines
      civicBallotUpdates
      civicLocalNews
      civicRepresentativeUpdates
      civicFrequency
      quietHoursEnabled
      quietHoursStart
      quietHoursEnd
      updatedAt
    }
  }
`;

export const UNSUBSCRIBE_FROM_ALL = gql`
  mutation UnsubscribeFromAll {
    unsubscribeFromAll {
      id
      emailEnabled
      pushEnabled
      smsEnabled
    }
  }
`;

// ============================================
// Consent Queries & Mutations
// ============================================

export const GET_MY_CONSENTS = gql`
  query MyConsents {
    myConsents {
      id
      userId
      consentType
      status
      documentVersion
      documentUrl
      grantedAt
      deniedAt
      withdrawnAt
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_CONSENT = gql`
  mutation UpdateConsent($input: UpdateConsentDto!) {
    updateConsent(input: $input) {
      id
      consentType
      status
      grantedAt
      deniedAt
      updatedAt
    }
  }
`;

export const WITHDRAW_CONSENT = gql`
  mutation WithdrawConsent($input: WithdrawConsentDto!) {
    withdrawConsent(input: $input) {
      id
      consentType
      status
      withdrawnAt
      updatedAt
    }
  }
`;

export const HAS_VALID_CONSENT = gql`
  query HasValidConsent($consentType: ConsentType!) {
    hasValidConsent(consentType: $consentType)
  }
`;

// ============================================
// Response Types
// ============================================

export interface MyProfileData {
  myProfile: UserProfile | null;
}

export interface UpdateMyProfileData {
  updateMyProfile: UserProfile;
}

export interface MyAddressesData {
  myAddresses: UserAddress[];
}

export interface CreateAddressData {
  createAddress: UserAddress;
}

export interface UpdateAddressData {
  updateAddress: UserAddress;
}

export interface DeleteAddressData {
  deleteAddress: boolean;
}

export interface SetPrimaryAddressData {
  setPrimaryAddress: UserAddress;
}

export interface MyNotificationPreferencesData {
  myNotificationPreferences: NotificationPreferences | null;
}

export interface UpdateNotificationPreferencesData {
  updateNotificationPreferences: NotificationPreferences;
}

export interface UnsubscribeFromAllData {
  unsubscribeFromAll: NotificationPreferences;
}

export interface MyConsentsData {
  myConsents: UserConsent[];
}

export interface UpdateConsentData {
  updateConsent: UserConsent;
}

export interface WithdrawConsentData {
  withdrawConsent: UserConsent;
}

export interface HasValidConsentData {
  hasValidConsent: boolean;
}

export interface MyProfileCompletionData {
  myProfileCompletion: ProfileCompletion;
}

export interface AvatarUploadUrlData {
  avatarUploadUrl: string;
}

export interface UpdateAvatarStorageKeyData {
  updateAvatarStorageKey: UserProfile;
}
