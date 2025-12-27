"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type {
  EducationLevel,
  IncomeRange,
  HomeownerStatus,
} from "@/lib/graphql/profile";

interface DemographicFieldsSectionProps {
  readonly occupation?: string;
  readonly educationLevel?: EducationLevel;
  readonly incomeRange?: IncomeRange;
  readonly householdSize?: string;
  readonly homeownerStatus?: HomeownerStatus;
  readonly onChange: (
    field:
      | "occupation"
      | "educationLevel"
      | "incomeRange"
      | "householdSize"
      | "homeownerStatus",
    value: string | EducationLevel | IncomeRange | HomeownerStatus | undefined,
  ) => void;
  readonly disabled?: boolean;
}

const EDUCATION_LEVELS: EducationLevel[] = [
  "high_school",
  "some_college",
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "trade_school",
  "prefer_not_to_say",
];

const INCOME_RANGES: IncomeRange[] = [
  "under_25k",
  "25k_50k",
  "50k_75k",
  "75k_100k",
  "100k_150k",
  "150k_200k",
  "over_200k",
  "prefer_not_to_say",
];

const HOMEOWNER_STATUSES: HomeownerStatus[] = [
  "own",
  "rent",
  "living_with_family",
  "other",
  "prefer_not_to_say",
];

const HOUSEHOLD_SIZES = ["1", "2", "3", "4", "5", "6+"];

export function DemographicFieldsSection({
  occupation,
  educationLevel,
  incomeRange,
  householdSize,
  homeownerStatus,
  onChange,
  disabled = false,
}: DemographicFieldsSectionProps) {
  const { t } = useTranslation("settings");
  const [isExpanded, setIsExpanded] = useState(false);

  const handleOccupationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      onChange("occupation", value || undefined);
    },
    [onChange],
  );

  const handleEducationChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value as EducationLevel | "";
      onChange("educationLevel", value || undefined);
    },
    [onChange],
  );

  const handleIncomeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value as IncomeRange | "";
      onChange("incomeRange", value || undefined);
    },
    [onChange],
  );

  const handleHouseholdChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onChange("householdSize", value || undefined);
    },
    [onChange],
  );

  const handleHomeownerChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value as HomeownerStatus | "";
      onChange("homeownerStatus", value || undefined);
    },
    [onChange],
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span className="font-medium text-[#1e293b]">
            {t("profile.demographic.title", "Demographic Information")}
          </span>
          <span className="text-xs text-gray-500 ml-2">
            {t("profile.demographic.optional", "(Optional)")}
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="p-4 space-y-4 bg-white">
          <p className="text-sm text-gray-500 mb-4">
            {t(
              "profile.demographic.description",
              "This information helps us better understand how policies and ballot measures may affect you personally. All information is kept private and secure.",
            )}
          </p>

          {/* Occupation */}
          <div>
            <label
              htmlFor="occupation"
              className="block text-sm font-medium text-[#1e293b] mb-1"
            >
              {t("profile.demographic.occupation", "Occupation")}
            </label>
            <input
              type="text"
              id="occupation"
              value={occupation || ""}
              onChange={handleOccupationChange}
              disabled={disabled}
              placeholder={t(
                "profile.demographic.occupationPlaceholder",
                "e.g., Software Engineer, Teacher, Nurse",
              )}
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Education Level */}
            <div>
              <label
                htmlFor="educationLevel"
                className="block text-sm font-medium text-[#1e293b] mb-1"
              >
                {t("profile.demographic.educationLevel", "Education Level")}
              </label>
              <select
                id="educationLevel"
                value={educationLevel || ""}
                onChange={handleEducationChange}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
              >
                <option value="">
                  {t("profile.demographic.selectOption", "Select an option")}
                </option>
                {EDUCATION_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(
                      `profile.demographic.education.${level}`,
                      level.replace(/_/g, " "),
                    )}
                  </option>
                ))}
              </select>
            </div>

            {/* Income Range */}
            <div>
              <label
                htmlFor="incomeRange"
                className="block text-sm font-medium text-[#1e293b] mb-1"
              >
                {t(
                  "profile.demographic.incomeRange",
                  "Annual Household Income",
                )}
              </label>
              <select
                id="incomeRange"
                value={incomeRange || ""}
                onChange={handleIncomeChange}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
              >
                <option value="">
                  {t("profile.demographic.selectOption", "Select an option")}
                </option>
                {INCOME_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {t(
                      `profile.demographic.income.${range}`,
                      range.replace(/_/g, " "),
                    )}
                  </option>
                ))}
              </select>
            </div>

            {/* Household Size */}
            <div>
              <label
                htmlFor="householdSize"
                className="block text-sm font-medium text-[#1e293b] mb-1"
              >
                {t("profile.demographic.householdSize", "Household Size")}
              </label>
              <select
                id="householdSize"
                value={householdSize || ""}
                onChange={handleHouseholdChange}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
              >
                <option value="">
                  {t("profile.demographic.selectOption", "Select an option")}
                </option>
                {HOUSEHOLD_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size === "6+"
                      ? t(
                          "profile.demographic.householdSizes.6plus",
                          "6 or more",
                        )
                      : t(
                          `profile.demographic.householdSizes.${size}`,
                          `${size} ${size === "1" ? "person" : "people"}`,
                        )}
                  </option>
                ))}
              </select>
            </div>

            {/* Homeowner Status */}
            <div>
              <label
                htmlFor="homeownerStatus"
                className="block text-sm font-medium text-[#1e293b] mb-1"
              >
                {t("profile.demographic.homeownerStatus", "Housing Status")}
              </label>
              <select
                id="homeownerStatus"
                value={homeownerStatus || ""}
                onChange={handleHomeownerChange}
                disabled={disabled}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
              >
                <option value="">
                  {t("profile.demographic.selectOption", "Select an option")}
                </option>
                {HOMEOWNER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(
                      `profile.demographic.homeowner.${status}`,
                      status.replace(/_/g, " "),
                    )}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
