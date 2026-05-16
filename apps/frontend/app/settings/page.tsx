"use client";

import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@apollo/client/react";
import { useTranslation } from "react-i18next";
import {
  GET_MY_PROFILE,
  GET_MY_PROFILE_COMPLETION,
  UPDATE_MY_PROFILE,
  MyProfileData,
  MyProfileCompletionData,
  UpdateMyProfileData,
  UpdateProfileInput,
  UserProfile,
  SupportedLanguage,
  PoliticalAffiliation,
  VotingFrequency,
  EducationLevel,
  IncomeRange,
  HomeownerStatus,
} from "@/lib/graphql/profile";
import { useLocale } from "@/lib/i18n/context";
import Link from "next/link";
import { ProfileCompletionIndicator } from "@/components/profile/ProfileCompletionIndicator";
import {
  MY_JURISDICTIONS,
  MyJurisdictionsData,
  JurisdictionLevel,
  MY_COUNTY_SUPERVISORS,
  MyCountySupervisorsData,
} from "@/lib/graphql/region";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { ProfileVisibilityToggle } from "@/components/profile/ProfileVisibilityToggle";
import { CivicFieldsSection } from "@/components/profile/CivicFieldsSection";
import { DemographicFieldsSection } from "@/components/profile/DemographicFieldsSection";

const TIMEZONES = [
  { value: "America/Los_Angeles", labelKey: "timezones.pacific" },
  { value: "America/Denver", labelKey: "timezones.mountain" },
  { value: "America/Chicago", labelKey: "timezones.central" },
  { value: "America/New_York", labelKey: "timezones.eastern" },
  { value: "America/Anchorage", labelKey: "timezones.alaska" },
  { value: "Pacific/Honolulu", labelKey: "timezones.hawaii" },
  { value: "UTC", labelKey: "timezones.utc" },
];

const LANGUAGES: { value: SupportedLanguage; labelKey: string }[] = [
  { value: "en", labelKey: "languages.en" },
  { value: "es", labelKey: "languages.es" },
];

interface ProfileFormProps {
  readonly profile: UserProfile;
  readonly onSave: () => void;
}

function ProfileForm({ profile, onSave }: Readonly<ProfileFormProps>) {
  const { t } = useTranslation("settings");
  const { locale, setLocale } = useLocale();
  const [updateProfile, { loading: updating }] =
    useMutation<UpdateMyProfileData>(UPDATE_MY_PROFILE);

  // Initialize form with all profile data
  const [formData, setFormData] = useState<UpdateProfileInput>({
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    displayName: profile.displayName || "",
    preferredName: profile.preferredName || "",
    phone: profile.phone || "",
    timezone: profile.timezone || "America/Los_Angeles",
    preferredLanguage: locale,
    bio: profile.bio || "",
    isPublic: profile.isPublic ?? false,
    politicalAffiliation: profile.politicalAffiliation,
    votingFrequency: profile.votingFrequency,
    policyPriorities: profile.policyPriorities,
    occupation: profile.occupation,
    educationLevel: profile.educationLevel,
    incomeRange: profile.incomeRange,
    householdSize: profile.householdSize,
    homeownerStatus: profile.homeownerStatus,
  });
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(profile.avatarUrl);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleChange = useCallback(
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const { name, value } = e.target;
      setFormData((prev) => ({ ...prev, [name]: value }));
      setSaveSuccess(false);
      setSaveError(null);

      // Update locale immediately when language changes
      if (name === "preferredLanguage") {
        setLocale(value as SupportedLanguage);
      }
    },
    [setLocale],
  );

  const handleVisibilityChange = useCallback((isPublic: boolean) => {
    setFormData((prev) => ({ ...prev, isPublic }));
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  const handleCivicChange = useCallback(
    (
      field: "politicalAffiliation" | "votingFrequency" | "policyPriorities",
      value: PoliticalAffiliation | VotingFrequency | string[] | undefined,
    ) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(false);
      setSaveError(null);
    },
    [],
  );

  const handleDemographicChange = useCallback(
    (
      field:
        | "occupation"
        | "educationLevel"
        | "incomeRange"
        | "householdSize"
        | "homeownerStatus",
      value:
        | string
        | EducationLevel
        | IncomeRange
        | HomeownerStatus
        | undefined,
    ) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(false);
      setSaveError(null);
    },
    [],
  );

  const handleAvatarUpdated = useCallback(
    (newUrl: string) => {
      setCurrentAvatarUrl(newUrl);
      onSave(); // Refetch to update completion indicator
    },
    [onSave],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await updateProfile({
        variables: { input: formData },
      });
      setSaveSuccess(true);
      onSave();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("common:errors.saveFailed"),
      );
    }
  };

  return (
    <>
      {/* Success Message */}
      {saveSuccess && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-600">{t("profile.saveSuccess")}</p>
        </div>
      )}

      {/* Error Message */}
      {saveError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{saveError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Avatar Upload */}
        <div className="flex justify-center py-4 border-b border-gray-100">
          <AvatarUpload
            currentAvatarUrl={currentAvatarUrl}
            onAvatarUpdated={handleAvatarUpdated}
          />
        </div>

        {/* Name Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="firstName"
              className="block text-sm font-medium text-[#222222] mb-2"
            >
              {t("profile.firstName")}
            </label>
            <input
              type="text"
              id="firstName"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors"
              placeholder={t("profile.firstNamePlaceholder")}
            />
          </div>
          <div>
            <label
              htmlFor="lastName"
              className="block text-sm font-medium text-[#222222] mb-2"
            >
              {t("profile.lastName")}
            </label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors"
              placeholder={t("profile.lastNamePlaceholder")}
            />
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label
            htmlFor="displayName"
            className="block text-sm font-medium text-[#222222] mb-2"
          >
            {t("profile.displayName")}
          </label>
          <input
            type="text"
            id="displayName"
            name="displayName"
            value={formData.displayName}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors"
            placeholder={t("profile.displayNamePlaceholder")}
          />
          <p className="mt-1 text-sm text-[#4d4d4d]">
            {t("profile.displayNameHint")}
          </p>
        </div>

        {/* Profile Visibility Toggle */}
        <div className="border-t border-gray-100 pt-4">
          <ProfileVisibilityToggle
            isPublic={formData.isPublic ?? false}
            onChange={handleVisibilityChange}
            disabled={updating}
          />
        </div>

        {/* Phone */}
        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-[#222222] mb-2"
          >
            {t("profile.phone")}
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors"
            placeholder={t("profile.phonePlaceholder")}
          />
        </div>

        {/* Timezone and Language */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="timezone"
              className="block text-sm font-medium text-[#222222] mb-2"
            >
              {t("profile.timezone")}
            </label>
            <select
              id="timezone"
              name="timezone"
              value={formData.timezone}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors bg-white"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {t(tz.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="preferredLanguage"
              className="block text-sm font-medium text-[#222222] mb-2"
            >
              {t("profile.language")}
            </label>
            <select
              id="preferredLanguage"
              name="preferredLanguage"
              value={formData.preferredLanguage}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors bg-white"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {t(lang.labelKey)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-[#4d4d4d]">
              {t("profile.languageHint")}
            </p>
          </div>
        </div>

        {/* Bio */}
        <div>
          <label
            htmlFor="bio"
            className="block text-sm font-medium text-[#222222] mb-2"
          >
            {t("profile.bio")}
          </label>
          <textarea
            id="bio"
            name="bio"
            value={formData.bio}
            onChange={handleChange}
            rows={4}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-[#222222] focus:ring-1 focus:ring-[#222222] outline-none transition-colors resize-none"
            placeholder={t("profile.bioPlaceholder")}
          />
          <p className="mt-1 text-sm text-[#4d4d4d]">{t("profile.bioHint")}</p>
        </div>

        {/* Civic Fields Section */}
        <CivicFieldsSection
          politicalAffiliation={formData.politicalAffiliation}
          votingFrequency={formData.votingFrequency}
          policyPriorities={formData.policyPriorities}
          onChange={handleCivicChange}
          disabled={updating}
        />

        {/* Demographic Fields Section */}
        <DemographicFieldsSection
          occupation={formData.occupation}
          educationLevel={formData.educationLevel}
          incomeRange={formData.incomeRange}
          householdSize={formData.householdSize}
          homeownerStatus={formData.homeownerStatus}
          onChange={handleDemographicChange}
          disabled={updating}
        />

        {/* Submit Button */}
        <div className="pt-4">
          <button
            type="submit"
            disabled={updating}
            className="px-6 py-3 bg-[#222222] text-white rounded-lg font-medium hover:bg-[#333333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updating ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </div>
      </form>
    </>
  );
}

export default function ProfileSettingsPage() {
  const { t } = useTranslation("settings");
  const {
    data: profileData,
    loading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery<MyProfileData>(GET_MY_PROFILE);
  const {
    data: completionData,
    loading: completionLoading,
    refetch: refetchCompletion,
  } = useQuery<MyProfileCompletionData>(GET_MY_PROFILE_COMPLETION);
  const { data: jurisdictionsData } = useQuery<MyJurisdictionsData>(
    MY_JURISDICTIONS,
    { fetchPolicy: "network-only" },
  );
  const { data: supervisorsData } = useQuery<MyCountySupervisorsData>(
    MY_COUNTY_SUPERVISORS,
    { fetchPolicy: "network-only" },
  );

  const handleSave = useCallback(() => {
    refetchProfile();
    refetchCompletion();
  }, [refetchProfile, refetchCompletion]);

  if (profileLoading || completionLoading) {
    return (
      <div className="space-y-6">
        {/* Completion Indicator Skeleton */}
        <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/4"></div>
            <div className="h-3 bg-gray-200 rounded-full w-full"></div>
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-gray-200 rounded-lg"></div>
              ))}
            </div>
          </div>
        </div>

        {/* Form Skeleton */}
        <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="space-y-3 mt-8">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        <div className="text-center text-red-600">
          <p>{t("profile.loadError")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Completion Indicator */}
      {completionData?.myProfileCompletion && (
        <ProfileCompletionIndicator
          completion={completionData.myProfileCompletion}
        />
      )}

      {/* Civic Jurisdictions — derived from primary address */}
      <JurisdictionsSection
        jurisdictions={jurisdictionsData?.myJurisdictions ?? null}
        loaded={jurisdictionsData !== undefined}
        t={t}
      />

      {/* County Board of Supervisors */}
      <CountySupervisorsSection
        supervisors={supervisorsData?.myCountySupervisors ?? null}
        loaded={supervisorsData !== undefined}
        t={t}
      />

      {/* Profile Form */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#222222]">
            {t("profile.title")}
          </h1>
          <p className="text-[#4d4d4d] mt-1">{t("profile.subtitle")}</p>
        </div>

        <ProfileForm
          key={profileData?.myProfile?.id ?? "new"}
          profile={profileData?.myProfile ?? ({} as UserProfile)}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JurisdictionsSection
// ---------------------------------------------------------------------------

// FEDERAL renders when congressional district rows exist in the jurisdictions table.
// The ETL currently loads CA state/county/city/district data but not congressional
// boundaries — add a loadCongressionalDistricts() call to load-ca-boundaries.ts
// to populate FEDERAL rows.
const LEVEL_ORDER: JurisdictionLevel[] = [
  "FEDERAL",
  "STATE",
  "COUNTY",
  "MUNICIPAL",
  "DISTRICT",
];

function JurisdictionsSection({
  jurisdictions,
  loaded,
  t,
}: {
  jurisdictions: MyJurisdictionsData["myJurisdictions"] | null;
  loaded: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!loaded) return null; // still fetching — don't flash empty state

  const hasJurisdictions = jurisdictions !== null && jurisdictions.length > 0;
  const isResolving = jurisdictions !== null && jurisdictions.length === 0;

  const byLevel = new Map<
    JurisdictionLevel,
    NonNullable<typeof jurisdictions>
  >();
  if (hasJurisdictions) {
    for (const uj of jurisdictions) {
      const level = uj.jurisdiction.level;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level)!.push(uj);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-semibold text-[#222222]">
          {t("profile.jurisdictions.title")}
        </h2>
        {hasJurisdictions && (
          <span className="text-xs text-[#6b7280]">
            {t("profile.jurisdictions.primaryAddressNote")}
          </span>
        )}
      </div>
      <p className="text-sm text-[#4d4d4d] mb-4">
        {t("profile.jurisdictions.subtitle")}
      </p>

      {/* No primary address set — prompt to add one */}
      {jurisdictions === null && (
        <p className="text-sm text-[#4d4d4d]">
          {t("profile.jurisdictions.empty")}{" "}
          <Link
            href="/settings/addresses"
            className="text-[#222222] underline underline-offset-2 hover:no-underline"
          >
            {t("profile.jurisdictions.emptyLink")}
          </Link>{" "}
          {t("profile.jurisdictions.emptyTail")}
        </p>
      )}

      {/* Primary address exists but geocoding hasn't resolved yet */}
      {isResolving && (
        <p className="text-sm text-[#4d4d4d] italic">
          {t("profile.jurisdictions.resolving")}
        </p>
      )}

      {/* Resolved jurisdictions grouped by level */}
      {hasJurisdictions && (
        <div className="divide-y divide-gray-100 -mx-6 border-t border-gray-100">
          {LEVEL_ORDER.filter((l) => byLevel.has(l)).map((level) => (
            <div key={level} className="px-6 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6b7280] mb-2">
                {t(`profile.jurisdictions.levels.${level}`)}
              </p>
              <ul className="space-y-1">
                {byLevel.get(level)!.map((uj) => (
                  <li
                    key={uj.jurisdiction.id}
                    className="text-sm text-[#222222]"
                  >
                    {uj.jurisdiction.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CountySupervisorsSection
// ---------------------------------------------------------------------------

function CountySupervisorsSection({
  supervisors,
  loaded,
  t,
}: {
  supervisors: MyCountySupervisorsData["myCountySupervisors"] | null;
  loaded: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!loaded) return null;
  if (!supervisors || supervisors.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
      <h2 className="text-lg font-semibold text-[#222222] mb-1">
        {t("profile.countySupervisors.title")}
      </h2>
      <p className="text-sm text-[#4d4d4d] mb-4">
        {t("profile.countySupervisors.subtitle")}
      </p>
      <ul className="divide-y divide-gray-100 -mx-6 border-t border-gray-100">
        {supervisors.map((rep) => (
          <li key={rep.id} className="px-6 py-3 flex items-center gap-3">
            {rep.photoUrl && (
              <img
                src={rep.photoUrl}
                alt={rep.name}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            )}
            <div>
              <p className="text-sm font-medium text-[#222222]">{rep.name}</p>
              <p className="text-xs text-[#6b7280]">
                {t("profile.countySupervisors.district", {
                  district: rep.district,
                })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
