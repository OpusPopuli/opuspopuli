"use client";

import { useTranslation } from "react-i18next";
import type { ProfileCompletion } from "@/lib/graphql/profile";

interface ProfileCompletionIndicatorProps {
  readonly completion: ProfileCompletion;
}

export function ProfileCompletionIndicator({
  completion,
}: ProfileCompletionIndicatorProps) {
  const { t } = useTranslation("settings");
  const { percentage, isComplete, suggestedNextSteps } = completion;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-none dark:border dark:border-gray-700 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("profile.completion.title", "Profile Completion")}
          </h3>
          {isComplete && (
            <p className="text-sm text-sage-darker dark:text-sage-light mt-1">
              {t("profile.completion.complete", "Your profile is complete!")}
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="text-3xl font-bold text-gray-900 dark:text-white">
            {percentage}%
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-sage-dark transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Core Fields Status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatusBadge
          label={t("profile.completion.fields.name", "Name")}
          complete={completion.coreFieldsComplete.hasName}
        />
        <StatusBadge
          label={t("profile.completion.fields.photo", "Photo")}
          complete={completion.coreFieldsComplete.hasPhoto}
        />
        <StatusBadge
          label={t("profile.completion.fields.address", "Address")}
          complete={completion.coreFieldsComplete.hasAddress}
        />
        <StatusBadge
          label={t("profile.completion.fields.civic", "Civic")}
          complete={completion.coreFieldsComplete.hasCivic}
        />
        <StatusBadge
          label={t("profile.completion.fields.demographic", "Demographic")}
          complete={completion.coreFieldsComplete.hasDemographic}
        />
      </div>

      {/* Suggested Next Steps */}
      {!isComplete && suggestedNextSteps.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
            {t("profile.completion.nextSteps", "Suggested next steps:")}
          </p>
          <ul className="space-y-2">
            {suggestedNextSteps.map((step, idx) => (
              <li
                key={idx}
                className="text-sm text-gray-900 dark:text-gray-100 flex items-start gap-2"
              >
                <span className="w-1.5 h-1.5 bg-sage-dark rounded-full mt-1.5 flex-shrink-0" />
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface StatusBadgeProps {
  readonly label: string;
  readonly complete: boolean;
}

function StatusBadge({ label, complete }: StatusBadgeProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
        complete
          ? "bg-sage-light/20 text-sage-darker dark:bg-sage-dark/20 dark:text-sage-light"
          : "bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400"
      }`}
    >
      {complete ? (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" strokeWidth={2} />
        </svg>
      )}
      <span>{label}</span>
    </div>
  );
}
