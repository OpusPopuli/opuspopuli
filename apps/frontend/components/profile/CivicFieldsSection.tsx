"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type {
  PoliticalAffiliation,
  VotingFrequency,
} from "@/lib/graphql/profile";

interface CivicFieldsSectionProps {
  readonly politicalAffiliation?: PoliticalAffiliation;
  readonly votingFrequency?: VotingFrequency;
  readonly policyPriorities?: string[];
  readonly onChange: (
    field: "politicalAffiliation" | "votingFrequency" | "policyPriorities",
    value: PoliticalAffiliation | VotingFrequency | string[] | undefined,
  ) => void;
  readonly disabled?: boolean;
}

const POLITICAL_AFFILIATIONS: PoliticalAffiliation[] = [
  "democrat",
  "republican",
  "independent",
  "libertarian",
  "green",
  "other",
  "prefer_not_to_say",
];

const VOTING_FREQUENCIES: VotingFrequency[] = [
  "every_election",
  "most_elections",
  "some_elections",
  "rarely",
  "never",
  "prefer_not_to_say",
];

const POLICY_PRIORITIES = [
  "healthcare",
  "economy",
  "education",
  "environment",
  "immigration",
  "gun_rights",
  "gun_control",
  "social_security",
  "taxes",
  "criminal_justice",
  "housing",
  "infrastructure",
  "national_security",
  "civil_rights",
  "womens_rights",
  "lgbtq_rights",
  "veterans_affairs",
  "labor_unions",
  "small_business",
  "agriculture",
];

export function CivicFieldsSection({
  politicalAffiliation,
  votingFrequency,
  policyPriorities = [],
  onChange,
  disabled = false,
}: CivicFieldsSectionProps) {
  const { t } = useTranslation("settings");
  const [isExpanded, setIsExpanded] = useState(false);

  const handlePoliticalChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value as PoliticalAffiliation | "";
      onChange("politicalAffiliation", value || undefined);
    },
    [onChange],
  );

  const handleVotingChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value as VotingFrequency | "";
      onChange("votingFrequency", value || undefined);
    },
    [onChange],
  );

  const handlePriorityToggle = useCallback(
    (priority: string) => {
      const current = policyPriorities || [];
      const updated = current.includes(priority)
        ? current.filter((p) => p !== priority)
        : [...current, priority];
      onChange("policyPriorities", updated.length > 0 ? updated : undefined);
    },
    [policyPriorities, onChange],
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
            className="w-5 h-5 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
            />
          </svg>
          <span className="font-medium text-[#1e293b]">
            {t("profile.civic.title", "Civic Information")}
          </span>
          <span className="text-xs text-gray-500 ml-2">
            {t("profile.civic.optional", "(Optional)")}
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
              "profile.civic.description",
              "This information helps us provide more relevant civic engagement recommendations and ballot information tailored to your interests.",
            )}
          </p>

          {/* Political Affiliation */}
          <div>
            <label
              htmlFor="politicalAffiliation"
              className="block text-sm font-medium text-[#1e293b] mb-1"
            >
              {t("profile.civic.politicalAffiliation", "Political Affiliation")}
            </label>
            <select
              id="politicalAffiliation"
              value={politicalAffiliation || ""}
              onChange={handlePoliticalChange}
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
            >
              <option value="">
                {t("profile.civic.selectOption", "Select an option")}
              </option>
              {POLITICAL_AFFILIATIONS.map((affiliation) => (
                <option key={affiliation} value={affiliation}>
                  {t(
                    `profile.civic.affiliations.${affiliation}`,
                    affiliation.replace(/_/g, " "),
                  )}
                </option>
              ))}
            </select>
          </div>

          {/* Voting Frequency */}
          <div>
            <label
              htmlFor="votingFrequency"
              className="block text-sm font-medium text-[#1e293b] mb-1"
            >
              {t("profile.civic.votingFrequency", "Voting Frequency")}
            </label>
            <select
              id="votingFrequency"
              value={votingFrequency || ""}
              onChange={handleVotingChange}
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:bg-gray-100"
            >
              <option value="">
                {t("profile.civic.selectOption", "Select an option")}
              </option>
              {VOTING_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {t(
                    `profile.civic.frequencies.${frequency}`,
                    frequency.replace(/_/g, " "),
                  )}
                </option>
              ))}
            </select>
          </div>

          {/* Policy Priorities */}
          <div>
            <label className="block text-sm font-medium text-[#1e293b] mb-2">
              {t("profile.civic.policyPriorities", "Policy Priorities")}
              <span className="text-xs text-gray-500 ml-2">
                {t("profile.civic.selectMultiple", "(Select all that apply)")}
              </span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {POLICY_PRIORITIES.map((priority) => (
                <label
                  key={priority}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer
                    transition-colors
                    ${
                      policyPriorities?.includes(priority)
                        ? "bg-blue-50 border-blue-300 text-blue-700"
                        : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                    }
                    ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                  `}
                >
                  <input
                    type="checkbox"
                    checked={policyPriorities?.includes(priority) || false}
                    onChange={() => handlePriorityToggle(priority)}
                    disabled={disabled}
                    className="sr-only"
                  />
                  <span
                    className={`
                      w-4 h-4 flex items-center justify-center rounded border
                      ${
                        policyPriorities?.includes(priority)
                          ? "bg-blue-500 border-blue-500"
                          : "border-gray-300"
                      }
                    `}
                  >
                    {policyPriorities?.includes(priority) && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="text-sm">
                    {t(
                      `profile.civic.priorities.${priority}`,
                      priority.replace(/_/g, " "),
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
